# Deployment information
* Information for deploying the application to a server,
not meant to be used locally.
* Server must have all the files referenced here and 
should have and rsk node installed and running locally. 

## Build and deploy
```
sudo docker-compose build --no-cache
sudo docker-compose up -d --force-recreate
```

## In this directory
* ``Dockerfile``: The Dockerfile for the application on server.
* ``docker-compose.yml``: All Docker services configuration on server.
* ``.env``: Environment variables for the application.
