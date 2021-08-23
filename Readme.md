## Rif Relay Server

This typescript repository contains all the server code used by the Rif Relay System.
This project works as a dependency or a standalone project.

### Pre-Requisites

* Node version 12.18
* RSKj Running Node. 
  * **Note: RSKj should run with `miner.minGasPrice=1` or higher than 0 in regtest to work properly with this server.**
* Rif Relay Contracts Deployed

#### How to start

To start working with this project you need to enable `postinstall` scripts, refer to section [Enable postinstall scripts](#enable-postinstall-scripts) to know how to do it. Then just run `npm install` to install all dependencies.

#### How to use it

#### As dependency

You can use this as dependency once you have it installed on your project. You have a few
ways to installing this dependency:

* **Use a release version:** just install this using the install command for node `npm i --save @rsksmart/rif-relay-server`.
* **Use the distributable directly from the repository:** modify your `package.json` file
  to add this line `"@rsksmart/rif-relay-server": "https://github.com/infuy/rif-relay-server",`
* **Use the development version directly from your changes:** clone this repository next to your project and modify your `package.json` file
  to add this line `"@rsksmart/rif-relay-server": "../rif-relay-server",`
  
After you install this dependency you can use the RelayServer and other classes to start the server or execute processes.

#### As Server

You can use this repository directly to start your server. To do so you need to setup the file `server-config.json` in the
root of the project to set all the contract addresses and server configurations. After that you just need to run `npm start`
to start your relay server.

#### How to register your running server

To work with the Rif Relay contracts the server has to be registered and to do that you need to run in another terminal
the next command `npm run register -- --funds="<FUNDS>" --stake="<STAKE>" --account="<ACCOUNT>" --mnemonic="<MNEMONIC>"` where:
* **FUNDS**: an optional amount of funds to setup (by default 10)
* **STAKE**: an optional the amount of stake to setup (by default 20)
* **ACCOUNT**: an optional account to use for funding and staking. (it requires mnemonic parameter)
* **MNEMONIC**: an optional mnemonic to use for unlock the account parameter. (it requires account parameter)
your workers.

#### How to generate a new distributable version

1. Bump the version on the `package.json` file.
2. Commit and push any changes included the bump.

#### For Github

1. Run `npm pack` to generate the tarball to be publish as release on github.
2. Generate a new release on github and upload the generated tarball.

#### For NPM

1. Run `npm login` to login to your account on npm registry.
2. Run `npm publish` to generate the distributable version for NodeJS

#### For direct use

1. Run `npm run dist` to generate the distributable version.
2. Commit and push the dist folder with the updated version to the repository on master.

**IMPORTANT: when you publish a version postinstall scripts must be disabled. This is disabled by default, don't push any changes to the postinstall scripts section in the `package.json` file.**

#### How to develop

If you need to modify resources inside this repository the first thing you always need to make sure of is that `postinstall` scripts are enabled in the `package.json` file. These are disabled by default due to distribution issues (which will be solved in the future), but will enable husky and other tools.

Then, run `npm install` to execute the post install hooks. After that, you can just make your modifications and then run `npm run build` to validate them. After you are done with your changes you can publish them by creating a distributable version.

#### Enable postinstall scripts

To enable `postinstall` scripts you need to modify the `package.json` file, specifically the section `scripts` and change the line `"_postinstall": "scripts/postinstall",` to `"postinstall": "scripts/postinstall",`.

#### Husky and linters

We use husky to check linters and code styles on commits, if you commit your
changes and the commit fails on lint or prettier checks you can use these command
to check and fix the errors before trying to commit again:

* `npm run lint`: to check linter bugs
* `npm run lint:fix`: to fix linter bugs
* `npm run prettier`: to check codestyles errors
* `npm run prettier:fix`: to fix codestyles errors
