import { FS } from './fs.js';
import { GitHubClient } from './github.client.js';
import { VIPS } from './vips.js';

const ghClient = new GitHubClient();
const vips = new VIPS();

const runAction = async (): Promise<void> => {
  const images = await ghClient.listAllImageFiles();
  if (images.length === 0) {
    console.log('No images found');
    return;
  }

  for (const image of images) {
    console.log(`Compressing ${image.repoPath}`);
    const compressedImagePath = await vips.compress(
      image.localPath,
      ghClient.processingOptions,
    );

    const [beforeStat, afterStat] = await Promise.all([
      FS.getFileStats(image.localPath),
      FS.getFileStats(compressedImagePath),
    ]);

    console.log({
      beforeStat,
      afterStat,
    });
  }
};

void runAction();
