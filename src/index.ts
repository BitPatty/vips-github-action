import { GitHubClient } from './github.client.js';
// import { VIPS } from './vips.js';

const ghClient = new GitHubClient();
// const vips = new VIPS();

const runAction = async (): Promise<void> => {
  const images = await ghClient.listAllImages();
  console.log(images);
};

void runAction();
