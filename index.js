#!/usr/bin/env node
const prog = require('caporal');
const path = require('path');
const rimraf = require('rimraf');
const shell = require('shelljs');
const IPFSFactory = require('ipfsd-ctl')

const os = require('os');
const ipfsAPI = require('ipfs-api');
const compileSolidityCwd = require('./emerald-solidity');
const ora = require('ora');
const opn = require('opn');
const tmp = require('tmp');
const EmeraldJs = require('emerald-js');
const Wallet = EmeraldJs.Wallet;
const ghdownload = require('github-download');
const { JsonRpc, HttpTransport, Vault, VaultJsonRpcProvider } = require('emerald-js');
const platform = os.platform();
const { EmeraldDeployer } = require('./emerald-contract');

const {eachSeries} = require('async');

const {promisify} = require('util');
const _fs = require('fs');
const fs = {
  readFile: promisify(_fs.readFile),
  writeFile: promisify(_fs.writeFile)
};

const commands = {
  vault() {
    let e;
    switch (platform) {
      case 'darwin':
      case 'linux':
        e = shell.exec(`${__dirname}/emerald-vault server`, {async: true});
        break
      case 'win32':
        e = shell.exec(`${__dirname}/emerald-vault.exe server`, {async: true})
        break
    }
    return e;
  }
}

prog
  .version('0.0.3')

  .command('new', 'Create a new project')
  .action((args, options, logger) => {
    const spinner = ora('Creating new project');
    spinner.start();
    return new Promise((resolve, reject) => {
      const tmpobj = tmp.dirSync();
      ghdownload({user: 'ETCDEVTeam', repo: 'emerald-starter-kit', ref: 'master'}, tmpobj.name)
        .on('err', (e) => {
          logger.debug('err', e)
          spinner.fail('failed to create ${JSON.stringify(e)}');
        })
        .on('end', () => {
          spinner.succeed('New Emerald project created');
          shell.mv(`${tmpobj.name}/*`, './');
          resolve();
        });
    });
  })

  .command('vault', 'Run emerald vault')
  .action((args, options, logger) => {
    return commands.vault();
  })

  .command('testrpc', 'Run testnet for ethereum classic')
  .argument('[passphrase]', 'passphrase to use for adding private keys to vault')
  .action((args, options, logger) => {
    let e;
    switch (platform) {
      case 'darwin':
      case 'linux':
        e = shell.exec(`${__dirname}/svmdev`, {async: true});
        break
      case 'win32':
        e = shell.exec(`${__dirname}/svmdev.exe`, {async: true})
        break
    }
    e.stdout.once('data', function(data) {
      const lines = data.split('\n');
      const group = lines.map((line, i) => {
        if (i % 2 === 0) {
          return
        } else {
          const address = lines[i - 1].split('address: ')[1];
          const privateKey = lines[i].split('private key: ')[1];
          logger.debug('before: import private key to vault:', privateKey);
          const keyfile = Wallet.fromPrivateKey(privateKey).toV3String(args.passphrase || "");
          const keyfileData = Object.assign(JSON.parse(keyfile), {
            name: 'emerald-testrpc',
            description: 'a test account for emerald testrpc'
          })
          return {
            address, privateKey, keyfileData
          }
        }
      }).filter(i => i);
      const vault = new Vault(new VaultJsonRpcProvider(new JsonRpc(new HttpTransport('http://127.0.0.1:1920'))));
      const promises = group.map(({keyfileData}) => {
        return vault.importAccount(keyfileData, 'mainnet');
      });
      Promise.all(promises).catch((e) => {
        logger.debug('error importing wallets to emerald-vault', e);
      })
    });
  })

  .command('wallet', 'Boot Emerald Wallet')
  .action((args, options, logger) => {
    switch (platform) {
      case 'darwin':
        return shell.exec(`open ${__dirname}/EmeraldWallet.app`);
      case 'linux':
        return shell.exec(`${__dirname}/EmeraldWallet.AppImage`);
      case 'win32':
        return shell.exec(`${__dirname}/EmeraldWallet.exe`);
    }
  })

  .command('explorer', 'Boot Explorer')
  .action((args, options, logger) => {
    opn(`${__dirname}/node_modules/@etclabscore/jade-explorer/build/app/index.html`);
  })

  .command('compile', 'Compile solidity')
  .action((args, options, logger) => {
    const p = path.resolve(process.cwd(), 'build/contracts');
    rimraf(`${p}/*`, (err) => {
      compileSolidityCwd();
    });
  })

  .command('ipfs', 'Run ipfs')
  .action(async (args, options, logger) => {
    return shell.exec(`${__dirname}/node_modules/.bin/jsipfs daemon`, {async: true});
  })

  .command('deploy ipfs', 'Deploy to ipfs')
  .option('--path', 'path to deploy')
  .action(async (args, options, logger) => {
    const ipfs = ipfsAPI('localhost', '5002', {protocol: 'http'});
    ipfs.util.addFromFs(path.resolve(process.cwd(), options.path || 'build/app'), { recursive: true }, (err, results) => {
      if (err) {
        return logger.error(err);
      }
      logger.info('Deployed the following files to IPFS:', results);
      logger.info('\n');
      logger.info('You can view them here:\n');
      logger.info('Local: ', `http://localhost:9090/ipfs/${results[results.length - 1].hash}`);
      logger.info('Public Gateway: ', `http://gateway.ipfs.io/ipfs/${results[results.length - 1].hash}`);
    });
  })

  .command('deploy contract', 'Deploy solidity to network')
  .action((args, options, logger) => {
    const files = shell.ls(`${process.cwd()}/build/contracts/**/*.json`).concat([]);

    eachSeries(files, async (file) => {
      const artifactFile = await fs.readFile(file, 'utf8');
      const artifact = JSON.parse(artifactFile);
      const deployer = new EmeraldDeployer(artifact);
      try {
        const result = await deployer.deploy();
        const transaction = await deployer.waitUntilDeployed();
        artifact.networks[deployer.chainId] = {
          ...artifact.networks[deployer.chainId],
          address: deployer.constructedTx.to,
          transactionHash: transaction.hash
        }
        await fs.writeFile(file, JSON.stringify(artifact, null, 4), 'utf8');
        return;
      } catch (e) {
        console.error(e);
        process.exit(1);
      }
    }, (err) => {
      console.log('done');

      if (err) {
        console.error(err);
      }

      process.exit(0);
    });
  })


  .command('multi-geth', 'Run multi-geth')
  .option('--classic', 'Ethereum Classic network: pre-configured Ethereum Classic mainnet')
  .option('--eth', 'Ethereum network: pre-configured Ethereum mainnet')
  .action((args, options, logger) => {
    console.log('options', options);
    let execArgs = ' --syncmode=fast --rpc --rpcport 8545 --rpcaddr 127.0.0.1 --rpccorsdomain="localhost" --rpcapi "eth,web3,net"';
    if (options.classic || !options.eth) {
      execArgs += ' --classic';
    }
    switch (platform) {
    case 'darwin':
      return shell.exec(`${__dirname}/geth${execArgs}`);
    case 'linux':
      return shell.exec(`${__dirname}/geth${execArgs}`);
    case 'win32':
      return shell.exec(`${__dirname}/geth.exe${execArgs}`);
    }
  })

prog.parse(process.argv);
