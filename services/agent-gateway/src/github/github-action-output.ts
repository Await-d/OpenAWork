export type CommitState = 'error' | 'failure' | 'pending' | 'success';

export type MergeMethod = 'merge' | 'squash' | 'rebase';

export interface PRReview {
  body: string;
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
  comments?: Array<{
    path: string;
    position: number;
    body: string;
  }>;
}

export interface PostCommentResult {
  commentId: number;
  htmlUrl: string;
}

export interface CreateReviewResult {
  reviewId: number;
  state: string;
  htmlUrl: string;
}

export interface SetCommitStatusResult {
  id: number;
  state: CommitState;
  context: string;
}

export interface CreateIssueResult {
  issueNumber: number;
  htmlUrl: string;
}

export interface MergePRResult {
  merged: boolean;
  sha: string;
  message: string;
}

import type { Octokit } from '@octokit/rest';

export type { Octokit as OctokitLike };

export class GitHubActionOutput {
  private readonly octokit: Octokit;

  constructor(octokit: Octokit) {
    this.octokit = octokit;
  }

  async postComment(
    owner: string,
    repo: string,
    issueNumber: number,
    body: string,
  ): Promise<PostCommentResult> {
    const { data } = await this.octokit.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body,
    });
    return { commentId: data.id, htmlUrl: data.html_url };
  }

  async createReview(
    owner: string,
    repo: string,
    prNumber: number,
    review: PRReview,
  ): Promise<CreateReviewResult> {
    const { data } = await this.octokit.pulls.createReview({
      owner,
      repo,
      pull_number: prNumber,
      body: review.body,
      event: review.event,
      comments: review.comments?.map((c) => ({ path: c.path, position: c.position, body: c.body })),
    });
    return { reviewId: data.id, state: data.state, htmlUrl: data.html_url };
  }

  async setCommitStatus(
    owner: string,
    repo: string,
    sha: string,
    state: CommitState,
    description: string,
    context: string,
    targetUrl?: string,
  ): Promise<SetCommitStatusResult> {
    const { data } = await this.octokit.repos.createCommitStatus({
      owner,
      repo,
      sha,
      state,
      description,
      context,
      target_url: targetUrl,
    });
    return { id: data.id, state: data.state as CommitState, context: data.context };
  }

  async createIssue(
    owner: string,
    repo: string,
    title: string,
    body: string,
    labels?: string[],
  ): Promise<CreateIssueResult> {
    const { data } = await this.octokit.issues.create({ owner, repo, title, body, labels });
    return { issueNumber: data.number, htmlUrl: data.html_url };
  }

  async mergePR(
    owner: string,
    repo: string,
    prNumber: number,
    options: { method: MergeMethod; commitTitle?: string; commitMessage?: string },
  ): Promise<MergePRResult> {
    const { data } = await this.octokit.pulls.merge({
      owner,
      repo,
      pull_number: prNumber,
      merge_method: options.method,
      commit_title: options.commitTitle,
      commit_message: options.commitMessage,
    });
    return { merged: data.merged, sha: data.sha ?? '', message: data.message ?? '' };
  }
}
