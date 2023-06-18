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

  const compressedImages: {
    sizeBefore: number;
    sizeAfter: number;
    repoPath: string;
    localPath: string;
  }[] = [];

  for (const image of images) {
    console.log(`Compressing ${image.repoPath}`);
    const compressedImagePath = await vips.compress(
      image.localPath,
      ghClient.processingOptions,
    );

    const [{ size: sizeBefore }, { size: sizeAfter }] = await Promise.all([
      FS.getFileStats(image.localPath),
      FS.getFileStats(compressedImagePath),
    ]);

    console.log({
      ...image,
      sizeBefore,
      sizeAfter,
    });

    if (sizeBefore <= sizeAfter) continue;
    if (sizeBefore - sizeAfter < ghClient.processingOptions.threshold) continue;

    compressedImages.push({
      repoPath: image.repoPath,
      localPath: compressedImagePath,
      sizeBefore,
      sizeAfter,
    });
  }

  await ghClient.createCommit(compressedImages);
  await ghClient.upsertPullRequest(compressedImages);
};

void runAction();
