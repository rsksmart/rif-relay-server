# Deployment information
* Information for deploying the application to a server,
not meant to be used locally.
* Server must have all the files referenced here and 
should have an RSK node installed and running locally. 
* Dockerfile and docker-compose.yml files should be on the root of the repository.

## Build and deploy
```
sudo docker-compose build --no-cache
sudo docker-compose up -d --force-recreate
```

## In this directory
* ``Dockerfile``: The Dockerfile for server application.
* ``docker-compose.yml``: All Docker services configuration.
