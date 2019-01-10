const request = require('request');
const tar = require('tar');
const path = require('path');
const os = require('os');
const ora = require('ora');

const downloadRelease = require('download-github-release');

const assetMap = {
  darwin: 'osx',
  linux: 'linux',
  win64: 'win64'
};

const user = 'ethoxy';
const repo = 'multi-geth';
const outputdir = path.resolve(__dirname, '../');
const leaveZipped = false;

const spinner = ora('geth: Downloading and Unpacking');
spinner.start();

const platform = os.platform()

const filterAsset = (asset) => {
  return asset.name.indexOf(assetMap[platform]) >= 0;
}

const filterRelease = (release) => {
  return release.prerelease === false;
}

downloadRelease(user, repo, outputdir, filterRelease, filterAsset, leaveZipped)
  .then(() => {
    spinner.succeed('geth: finished installation')
  })
  .catch((e) => {
    spinner.fail(`geth: ${JSON.stringify(e)}`);
  })
