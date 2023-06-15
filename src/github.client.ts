import { getInput } from '@actions/core';
import { context, getOctokit } from '@actions/github';
import { readFile } from 'fs/promises';
import { join, resolve } from 'path';

export type ImageFile = {
  repoPath: string;
  localPath: string;
};

export class GitHubClient {
  /**
   * The Octokit instance
   */
  readonly #internalClient: ReturnType<typeof getOctokit>;

  /**
   * The file endings to consider when scanning for image files
   */
  readonly #fileEndings: string[] = ['png', 'jpeg', 'jpg', 'gif'];

  /**
   * The commit message to use when committing the updated images
   */
  readonly #commitMessage: string = 'compress images';

  /**
   * The workspace directory where the checked out code lies
   *
   * See https://docs.github.com/en/actions/learn-github-actions/variables#default-environment-variables
   */
  readonly #workspace = process.env.GITHUB_WORKSPACE as string;

  public constructor() {
    const token = getInput('github-token', { required: true });
    this.#internalClient = getOctokit(token);

    // Set the commit message
    const commitMessage = getInput('commit-message', { required: false });
    if (commitMessage && commitMessage.trim().length > 0)
      this.#commitMessage = commitMessage;

    // Set the file endings
    const fileEndings = getInput('file-endings', { required: false });
    if (fileEndings && fileEndings.replace(/,/g, '').trim().length > 0)
      this.#fileEndings = fileEndings
        .split(',')

        .filter((e) => e.trim().length > 0)
        .map((f) => f.toLowerCase());
  }

  /**
   * The processing options specified in the workflow configuration
   */
  public get processingOptions(): {
    quality: number;
    stripMetadata: boolean;
    threshold: number;
  } {
    return {
      quality: 1,
      stripMetadata: true,
      threshold: 0,
    };
  }

  /**
   * Creates a new commit
   *
   * @param images  The image paths
   */
  public async createCommit(images: ImageFile[]): Promise<void> {
    const imageBlobs: {
      path: string;
      type: 'blob';
      mode: '100644';
      sha: string;
    }[] = [];

    for (const image of images) {
      const encodedImage = await readFile(image.localPath, {
        encoding: 'base64',
      });

      const blob = await this.#internalClient.rest.git.createBlob({
        owner: context.repo.owner,
        repo: context.repo.repo,
        content: encodedImage,
        encoding: 'base64',
      });

      imageBlobs.push({
        path: image.repoPath,
        type: 'blob',
        mode: '100644',
        sha: blob.data.sha,
      });
    }

    const tree = await this.#internalClient.rest.git.createTree({
      owner: context.repo.owner,
      repo: context.repo.repo,
      base_tree: context.sha,
      tree: [],
    });

    const commit = await this.#internalClient.rest.git.createCommit({
      owner: context.repo.owner,
      repo: context.repo.repo,
      tree: tree.data.sha,
      parents: [context.sha],
      message: this.#commitMessage,
    });

    await this.#internalClient.rest.git.updateRef({
      owner: context.repo.owner,
      repo: context.repo.repo,
      ref: `heads/${context.ref}`,
      sha: commit.data.sha,
    });
  }

  /**
   * Lists all image files on the current ref
   *
   * @returns  The image files
   */
  public listAllImageFiles(): Promise<ImageFile[]> {
    return this.#listCommitImageFiles(context.sha, true);
  }

  /**
   * Lists all image files that have been changed on the current ref
   *
   * @returns  The image files
   */
  public listChangedImageFiles(): Promise<ImageFile[]> {
    const pullRequest = context.payload.pull_request;
    if (!pullRequest) return this.#listCommitImageFiles(context.sha);
    return this.#listPrImages(pullRequest.number);
  }

  /**
   * Lists the image files of the specified commit
   *
   * @param sha               The commit hash
   * @param includeUnchanged  Whether to include image files that
   *                          have not been changed on that commit
   * @returns                 The matching image files
   */
  async #listCommitImageFiles(
    sha: string,
    includeUnchanged = false,
  ): Promise<ImageFile[]> {
    const commit = await this.#internalClient.rest.repos.getCommit({
      owner: context.repo.owner,
      repo: context.repo.repo,
      ref: sha,
    });
    if (!commit.data.files) return [];
    return this.#resolveImageFilePaths(commit.data.files, includeUnchanged);
  }

  /**
   * Lists the image files that have changed on a pull request
   *
   * @param prNumber  The number of the pull request
   * @returns         The image files
   */
  async #listPrImages(prNumber: number): Promise<ImageFile[]> {
    const pr = await this.#internalClient.rest.pulls.listFiles({
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number: prNumber,
    });

    return this.#resolveImageFilePaths(pr.data);
  }

  /**
   * Checks whether the specified file should be considered to be
   * an image file
   *
   * @param filePath  The file path
   * @returns         True if the file should be considered to be
   *                  an image file
   */
  #isImageFile(filePath: string): boolean {
    return this.#fileEndings.includes(
      filePath.split('.').pop()?.toLowerCase() ?? '',
    );
  }

  /**
   * Resolves the file paths of the specified commit changes
   *
   * @param changes           The commit changes
   * @param includeUnchanged  Whether to include unchanged image files
   * @returns                 The image files
   */
  #resolveImageFilePaths(
    changes: { status: 'added' | 'changed' | string; filename: string }[],
    includeUnchanged = false,
  ): ImageFile[] {
    return changes
      .filter((c) =>
        includeUnchanged
          ? c.status !== 'removed'
          : c.status === 'added' || c.status === 'changed',
      )
      .filter((c) => this.#isImageFile(c.filename))
      .map((c) => c.filename)
      .map((f) => ({
        repoPath: f,
        localPath: resolve(join(this.#workspace, f)),
      }));
  }
}
