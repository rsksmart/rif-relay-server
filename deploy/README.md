# Deployment information

* ``Note``: Information for deploying the ``rif-relay-server`` and a ``relaying-services-sdk-dapp`` to a server, not meant to be used locally.
* Server must have all the files referenced here and 
should have an RSK node installed and running locally. 
* ``Dockerfile`` and ``docker-compose.yml`` files should be on the root of the repository.
* ``relaying-services-sdk-dapp``(https://github.com/wilsoniovlabs/relaying-services-sdk-dapp) should be cloned in the same directory as docker-compose.yml

* Server should have the following file sctructure:

```
 - /home/user/workspace/enveloping/environment
 - /home/user/workspace/enveloping/environment/manager
 - /home/user/workspace/enveloping/environment/workers
```
* Run registration after docker-compose up and server is started.
* rif-relay-contracts adresses that are located on server-config.json should be deployed and "founded" on the local rsk node.

## Build and deploy
```
sudo docker-compose build --no-cache
sudo docker-compose up -d --force-recreate
```

## In this directory
* ``Dockerfile``: The Dockerfile for server application.
* ``docker-compose.yml``: All Docker services configuration.
