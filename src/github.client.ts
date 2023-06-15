import { getInput } from '@actions/core';
import { context, getOctokit } from '@actions/github';
import { readFile } from 'fs/promises';
import { resolve } from 'path';

export type ImageFile = {
  repoPath: string;
  localPath: string;
};

export class GitHubClient {
  readonly #internalClient: ReturnType<typeof getOctokit>;
  readonly #fileEndings: string[] = ['png', 'jpeg', 'jpg', 'gif'];
  readonly #commitMessage: string = 'compress images';

  public constructor() {
    const token = getInput('gh-token', { required: true });
    this.#internalClient = getOctokit(token);

    const commitMessage = getInput('commit-message', { required: false });
    if (commitMessage && commitMessage.trim().length > 0)
      this.#commitMessage = commitMessage;

    const fileEndings = getInput('file-endings', { required: false });
    if (fileEndings && fileEndings.replace(/,/g, '').trim().length > 0)
      this.#fileEndings = fileEndings
        .split(',')

        .filter((e) => e.trim().length > 0)
        .map((f) => f.toLowerCase());
  }

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

  public listAllImages(): Promise<ImageFile[]> {
    return this.#listCommitImages(context.sha, true);
  }

  public listChangedImages(): Promise<ImageFile[]> {
    const pullRequest = context.payload.pull_request;
    if (!pullRequest) return this.#listCommitImages(context.sha);
    return this.#listPrImages(pullRequest.number);
  }

  async #listCommitImages(
    sha: string,
    includeUnchanged = false,
  ): Promise<ImageFile[]> {
    const commit = await this.#internalClient.rest.repos.getCommit({
      owner: context.repo.owner,
      repo: context.repo.repo,
      ref: sha,
    });
    if (!commit.data.files) return [];
    return this.#resolveRepoPaths(commit.data.files, includeUnchanged);
  }

  async #listPrImages(prNumber: number): Promise<ImageFile[]> {
    const pr = await this.#internalClient.rest.pulls.listFiles({
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number: prNumber,
    });

    return this.#resolveRepoPaths(pr.data);
  }

  #isImageFile(filePath: string): boolean {
    return this.#fileEndings.includes(
      filePath.split('.').pop()?.toLowerCase() ?? '',
    );
  }

  #resolveRepoPaths(
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
        localPath: resolve(f),
      }));
  }
}
