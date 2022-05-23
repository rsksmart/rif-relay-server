# RIF Relay Server

This typescript repository contains all the server code used by the RIF Relay System.

This project works as a dependency as well as a stand-alone project.

## Table of Contents

- [**Installation**](#installation)
  - [**Pre-requisites**](#pre-requisites)
  - [**Dependencies**](#dependencies)
- [**System usage**](#system-usage)
  - [**Server execution**](#server-execution)
  - [**Server registration**](#server-registration)
- [**Library usage**](#library-usage)
  - [**Use a release version**](#use-a-release-version)
  - [**Use the repo distributable**](#use-the-repo-distributable)
  - [**Use a local distributable**](#use-a-local-distributable)
- [**Development**](#development)
  - [**Enabling postinstall scripts**](#enabling-postinstall-scripts)
  - [**Husky and linters**](#husky-and-linters)
  - [**Generating a new distributable version**](#generating-a-new-distributable-version)
    - [**For GitHub**](#for-github) 
    - [**For NPM**](#for-npm)
    - [**For direct use (no publishing)**](#for-direct-use-no-publishing)

## Installation

### Pre-requisites

- Node version 12.18
- RSKj Running Node. 
  - **Note: To work properly with this server in Regtest, please use the RSKj configuration that can be found [here](https://github.com/rsksmart/rif-relay/blob/master/rsknode/node.conf).**
- [RIF Relay Contracts](https://github.com/anarancio/rif-relay-contracts) deployed

### Dependencies

To start working with this project you need to first enable `postinstall` scripts (refer to section [Enabling postinstall scripts](#enabling-postinstall-scripts)).

Then just run `npm install` to install all dependencies.

## System usage

### Server execution

You can use this repository directly to start your server. 

To start the relay server, you need to configure the json config file located at `<PROJECT_ROOT>/server-config.json` which has this structure:
   
```json
{
  "url": "localhost",
  "port": 8090,
  "relayHubAddress": "0x3bA95e1cccd397b5124BcdCC5bf0952114E6A701",
  "relayVerifierAddress": "0x74Dc4471FA8C8fBE09c7a0C400a0852b0A9d04b2",
  "deployVerifierAddress": "0x1938517B0762103d52590Ca21d459968c25c9E67",
  "gasPriceFactor": 1,
  "rskNodeUrl": "http://rsk-node:4444",
  "devMode": true,
  "customReplenish": false,
  "logLevel": 1,
  "workdir": "/home/user/workspace/relay"
}
```

Where:
- **url**: is the URL where the relay server will be deployed, it could be localhost or the IP of the host machine.
- **port**: the port where the relay server will be hosted.
- **relayHubAddress**: is the relay hub contract address, you can retrieve this from the contract summary.
- **relayVerifierAddress**: is the relay verifier contract address, you can retrieve this from the contract summary.
- **deployVerifierAddress**: is the deploy verifier contract address, you can retrieve this from the contract summary.
- **gasPriceFactor**: is the gas price factor used to calculate the gas on the server, you can leave it as 1.
- **rskNodeUrl**: is the RSK node endpoint URL, where the RSK node is located.
- **devMode**: it indicates to the server if we are in development mode or not.
- **customReplenish**: set if the server uses a custom replenish function or not.
- **logLevel**: is the log level for the relay server.
- **workdir**: is the absolute path to the folder where the server will store the database and all its data.

Afterwards, run the following command:

```bash
npm run start -- -c "<PATH>"
``` 

The long options command is also available on Linux:

```bash
npm run start -- --config_file="<PATH>"
``` 

where:
- **CONFIG_FILE**: an optional path to an alternative configuration file. If not specified, the server will be started using server-config.json.

The command shows its usage with the `-h` parameter:

```bash
npm run start -- -h
```

You can browse the `getAddr` endpoint (e.g. by doing `curl` to `http://localhost:8090/getaddr`) to verify the server is running correctly as well as visualize some useful information:

```json
{
    "relayWorkerAddress": "0xe722143177fe9c7c58057dc3d98d87f6c414dc95",
    "relayManagerAddress": "0xe0820002dfaa69cbf8add6a738171e8eb0a5ee54",
    "relayHubAddress": "0x38bebd507aBC3D76B10d61f5C95668e1240D087F",
    "minGasPrice": "6000000000",
    "chainId": "31",
    "networkId": "31",
    "ready": false,
    "version": "2.0.1"
}
```

If it's the first time the server is run, some logs will state that the server isn't ready and that some values are wrong. This is expected, you just need to register the server on the relay hub in order for it to be usable by the clients.

### Server registration

Once the relay server is up, you need to register it in order for it to be usable.

Run the following command:

```bash
npm run register -- -f "<FUNDS>" -s "<STAKE>" -a "<ACCOUNT>" -m "<MNEMONIC>" -c "<PATH>"
``` 

The long options command is also available on Linux:

```bash
npm run register -- --funds="<FUNDS>" --stake="<STAKE>" --account="<ACCOUNT>" --mnemonic="<MNEMONIC>" --config_file="<PATH>"
``` 

where:
- **FUNDS**: an optional amount of funds to set up (by default 10)
- **STAKE**: an optional the amount of stake to set up (by default 20)
- **ACCOUNT**: an optional account to use for funding and staking (it requires the mnemonic parameter)
- **MNEMONIC**: an optional mnemonic to use for unlocking the account parameter (it requires the account parameter)
- **CONFIG_FILE**: an optional path to an alternative configuration file. If not specified, the server will be registered using server-config.json.

The command shows its usage with the `-h` parameter:

```bash
npm run register -- -h
```

After this you will be seeing several log entries indicating how everything is turning out. After a little while, look for this entry in the relay server execution terminal to make sure that the server is ready:

```
Relayer state: READY
```

## Library usage

You can use this dependency once you have it installed on your project. There are multiple ways to do this:

### Use a release version 

Install with:
```bash
npm i --save @rsksmart/rif-relay-server
```

### Use the repo distributable

Modify your `package.json` file to add the following line:

``` 
"@rsksmart/rif-relay-server": "https://github.com/infuy/rif-relay-server",
```

### Use a local distributable

Clone this repository inside your project's root folder, and modify your `package.json` file to add the following line: 

```
"@rsksmart/rif-relay-server": "../rif-relay-server",
```

## Development

If you need to modify resources inside this repository: 
- make sure that [`postinstall` scripts are enabled](#enabling-postinstall-scripts) in the `package.json` file. These are disabled by default due to distribution issues (which will be solved in the future), but will enable husky and other tools.
- run `npm install` to execute the post install hooks. 

After that, make your modifications and then run `npm run build` to validate them. 

After you are done with your changes you can publish them by creating a distributable version.

### Enabling postinstall scripts

To enable `postinstall` scripts you need to modify the `package.json` file, specifically the `scripts` section and change this line:

```
"_postinstall": "scripts/postinstall",
``` 
to 
```
"postinstall": "scripts/postinstall",
```

### Husky and linters

We use husky to check linters and code styles on commits, if you commit your
changes and the commit fails on lint or prettier checks you can use these command
to check and fix the errors before trying to commit again:

* `npm run lint`: to check linter bugs
* `npm run lint:fix`: to fix linter bugs
* `npm run prettier`: to check codestyles errors
* `npm run prettier:fix`: to fix codestyles errors

## ts-node
In order to run the server without having to rebuild every time a change is made, use the following command:
* `npm run debug`: run the server with ts-node

### Generating a new distributable version

**IMPORTANT: when you publish a version postinstall scripts must be disabled. This is disabled by default, so don't push any changes to the postinstall scripts section in the `package.json` file.**

1. Run the `npm run dist` command to generate the `dist` folder with the distributable version inside.
2. Bump the version on the `package.json` file (not strictly needed).
3. Commit and push any changes, including the version bump.

#### For GitHub

1. Run `npm pack` to generate the tarball to be published as a release on GitHub.
2. Generate a new release on GitHub and upload the generated tarball.

#### For NPM

1. Run `npm login` to login to your account on npm registry.
2. Run `npm publish` to generate the distributable version for NodeJS.

#### For direct use (no publishing)

No extra steps are needed beyond generating the `dist` folder and merging it to `master`.
