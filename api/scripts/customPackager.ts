import AdmZip from 'adm-zip';
import * as ChildProcess from 'child-process-es6-promise';
import * as FileSystem from 'fs-extra';
import process from 'process';
import './typings';

class Packager {

    /*
     * Take the file serverless produces and create node_modules folder programmatically
     */
    public async execute(): Promise<void> {

        await this._unzipPackage('authorize');
        await this._unzipPackage('basicapi');

        await this._excludeFolders('authorize', ['js/service', 'data']);
        await this._excludeFolders('basicapi', ['js/authorizer']);

        await this._excludeConfigFileSections('authorize', ['app']);
        await this._excludeConfigFileSections('basicapi', ['oauth']);

        await this._installDependencies('authorize', ['middy']);
        await this._installDependencies('basicapi',  ['js-sha256', 'openid-client']);

        await this._rezipPackage('authorize');
        await this._rezipPackage('basicapi');
    }

    /*
     * Unzip a package to a temporary folder for customizing
     */
    private async _unzipPackage(packageName: string) {

        const zip = new AdmZip(`.serverless/${packageName}.zip`);
        zip.extractAllTo(`.serverless/${packageName}`, true);
    }

    /*
     * Remove folders not relevant to this lambda
     */
    private async _excludeFolders(packageName: string, folders: string[]) {

        for (const folder of folders) {
            await FileSystem.remove(`.serverless/${packageName}/${folder}`);
        }
    }

    /*
     * Remove sections from the configuration file that are not relevant to this lambda
     */
    private async _excludeConfigFileSections(packageName: string, sections: string[]) {

        const config = await FileSystem.readJson(`.serverless/${packageName}/api.config.json`);
        for (const section of sections) {
            delete config[section];
        }

        await FileSystem.writeFile(`.serverless/${packageName}/api.config.json`, JSON.stringify(config, null, 2));
    }

    /*
     * Install dependencies for the package in an optimized manner resulting in smaller lambda sizes
     */
    private async _installDependencies(packageName: string, removeDependencies: string[]) {

        // Copy in files
        await FileSystem.copy('package.json', `.serverless/${packageName}/package.json`);
        await FileSystem.copy('package-lock.json', `.serverless/${packageName}/package-lock.json`);

        // Remove passed in dependencies and development dependencies
        const pkg = await FileSystem.readJson(`.serverless/${packageName}/package.json`);
        delete pkg.devDependencies;
        delete pkg.scripts;
        for (const dependency of removeDependencies) {
            delete pkg.dependencies[dependency];
        }

        // Write back changes and include formatting
        await FileSystem.writeFile(`.serverless/${packageName}/package.json`, JSON.stringify(pkg, null, 2));

        // Do the work of installing node modules
        await this._installNodeModules(packageName);

        // Remove package-lock.json from the temporary folder
        await FileSystem.remove(`.serverless/${packageName}/package-lock.json`);
    }

    /*
     * Start a child process to install node modules and wait for it to complete
     */
    private async _installNodeModules(packageName: string) {

        try {
            console.log(`Installing node modules for ${packageName} ...`);
            const npmCommand = /^win/.test(process.platform) ? 'npm.cmd' : 'npm';
            const options = {
                cwd: `.serverless/${packageName}`,
                capture: ['stdout', 'stderr'],
            };
            const childProcess = await ChildProcess.spawn(npmCommand, ['install'], options);
            console.log(childProcess.stdout);
        } catch (e) {
            throw new Error(`Error installing npm packages for ${packageName}: ${e} : ${e.stderr.toString()}`);
        }
    }

    /*
     * Rezip the package ready to deploy as a lambda
     */
    private async _rezipPackage(packageName: string) {

        // Delete the zip package that serverless created
        await FileSystem.remove(`.serverless/${packageName}.zip`);

        // Recreate the zip package
        const zip = new AdmZip();
        zip.addLocalFolder(`.serverless/${packageName}`);
        zip.writeZip(`.serverless/${packageName}.zip`);

        // Delete the temporary folder
        await FileSystem.remove(`.serverless/${packageName}`);
    }
}

(async () => {
    try {
        const packager = new Packager();
        await packager.execute();
    } catch (e) {
        console.log(`Packaging error: ${e}`);
        process.exit(1);
    }
})();