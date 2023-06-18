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
    const token = getInput('token', { required: true });
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
    pngCompressionLevel: number;
    branch: string;
    jpegProgressive: boolean;
  } {
    return {
      quality: 80,
      stripMetadata: true,
      threshold: 0,
      pngCompressionLevel: 9,
      jpegProgressive: true,
      branch: 'vips',
    };
  }

  /**
   * Upserts the pull request to merge the compressed images
   *
   * @param imageData  The image data
   */
  public async upsertPullRequest(
    imageData: Array<ImageFile & { sizeBefore: number; sizeAfter: number }>,
  ): Promise<void> {
    const defaultBranch = await this.#getDefaultBranch({
      owner: context.repo.owner,
      repo: context.repo.repo,
    });

    const prText = this.#buildPRText(imageData);

    const existingPRs = await this.#internalClient.rest.pulls.list({
      owner: context.repo.owner,
      repo: context.repo.repo,
      state: 'open',
      base: defaultBranch,
      head: this.processingOptions.branch,
    });

    const matchingPR = existingPRs.data.find(
      (d) =>
        d.head.repo.owner.login === context.repo.owner &&
        d.head.repo.name === context.repo.repo &&
        d.head.ref === this.processingOptions.branch,
    );

    if (matchingPR) {
      console.log(`Updating Pull Request #${matchingPR.number}`);
      await this.#internalClient.rest.pulls.update({
        owner: context.repo.owner,
        repo: context.repo.repo,
        pull_number: matchingPR.number,
        body: prText,
        title: 'Compress Images',
      });
    } else {
      console.log(`Opening Pull Request`);
      await this.#internalClient.rest.pulls.create({
        owner: context.repo.owner,
        repo: context.repo.repo,
        pull_number: existingPRs.data[0].number,
        body: prText,
        base: defaultBranch,
        head: this.processingOptions.branch,
        title: 'Compress Images',
      });
    }
  }

  /**
   * Creates a new commit
   *
   * @param images  The image paths
   * @param branch  The branch to publish the changes to
   */
  public async createCommit(
    images: ImageFile[],
  ): Promise<{ ref: string; sha: string }> {
    const head = `heads/${this.processingOptions.branch}`;
    const ref = `refs/${head}`;

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
      tree: imageBlobs,
    });

    const commit = await this.#internalClient.rest.git.createCommit({
      owner: context.repo.owner,
      repo: context.repo.repo,
      tree: tree.data.sha,
      parents: [context.sha],
      message: this.#commitMessage,
    });

    const refs = await this.#internalClient.rest.git.listMatchingRefs({
      owner: context.repo.owner,
      repo: context.repo.repo,
      ref: head,
    });

    const refExists = refs.data.some((r) => r.ref === ref);

    const res = await this.#internalClient.rest.git[
      refExists ? 'updateRef' : 'createRef'
    ]({
      owner: context.repo.owner,
      repo: context.repo.repo,
      ref: refExists ? head : ref,
      sha: commit.data.sha,
      force: true,
    });

    return {
      ref: res.data.ref,
      sha: res.data.object.sha,
    };
  }

  /**
   * Lists all image files on the current ref
   *
   * @returns  The image files
   */
  public async listAllImageFiles(): Promise<ImageFile[]> {
    const tree = await this.#internalClient.rest.git.getTree({
      owner: context.repo.owner,
      repo: context.repo.repo,
      tree_sha: context.sha,
      recursive: 'true',
    });

    return this.#resolveImageFilePaths(
      tree.data.tree.map((t) => ({ filename: t.path ?? 'N/A' })),
    );
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

    return this.#resolveImageFilePaths(
      commit.data.files.filter((c) =>
        includeUnchanged
          ? c.status !== 'removed'
          : c.status === 'added' || c.status === 'changed',
      ),
    );
  }

  /**
   * Gets the default branch for the specified repository
   *
   * @param repo  The repository
   * @returns     The default branch name
   */
  async #getDefaultBranch(repo: {
    owner: string;
    repo: string;
  }): Promise<string> {
    const r = await this.#internalClient.rest.repos.get(repo);
    return r.data.default_branch;
  }

  /**
   * Builds the text for the pull request body
   *
   * @param imageData  The context for the compressed files
   * @returns          The body content
   */
  #buildPRText(
    imageData: Array<ImageFile & { sizeBefore: number; sizeAfter: number }>,
  ): string {
    return [
      `Compressed Images:`,
      `| Path | Previous Size (KB) | New Size (KB) | Diff |`,
      `| --- | --- | --- | --- |`,
      ...imageData.map(
        (d) =>
          `| \`${d.repoPath}\` | \`${d.sizeBefore}\` | \`${
            d.sizeAfter
          }\` | \`-${(
            (100 * (d.sizeBefore - d.sizeAfter)) /
            d.sizeBefore
          ).toFixed(2)}%\``,
      ),
    ].join('\n');
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

    return this.#resolveImageFilePaths(
      pr.data.filter((c) => c.status === 'added' || c.status === 'changed'),
    );
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
   * @returns                 The image files
   */
  #resolveImageFilePaths(changes: { filename: string }[]): ImageFile[] {
    return changes

      .filter((c) => this.#isImageFile(c.filename))
      .map((c) => c.filename)
      .map((f) => ({
        repoPath: f,
        localPath: resolve(join(this.#workspace, f)),
      }));
  }
}
