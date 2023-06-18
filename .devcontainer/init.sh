#!/bin/bash
set -ex
curl -s https://raw.githubusercontent.com/nektos/act/master/install.sh | sudo bash
nvm install
nvm use
nvm alias default $(node --version)
nvm install-latest-npm
npm i
