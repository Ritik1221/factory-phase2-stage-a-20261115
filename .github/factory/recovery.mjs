export function reconcileTaskCreation(operation, matchingIssues, now, settleMs = 10 * 60_000) {
  if (matchingIssues.length > 1) return { action: 'needs-human', reason: 'multiple issues own the same task id' };
  if (matchingIssues.length === 1) return { action: 'complete', issue: matchingIssues[0].number };
  if (operation?.status === 'pending' && now - operation.started_at < settleMs) return { action: 'wait', reason: 'GitHub issue creation may still be becoming consistent' };
  return { action: 'retry' };
}

export function reconcileMerge(pullRequest, expectedSha) {
  if (!pullRequest) return { action: 'needs-human', reason: 'pull request disappeared' };
  if (pullRequest.merged_at) {
    return pullRequest.head.sha === expectedSha
      ? { action: 'complete' }
      : { action: 'needs-human', reason: 'pull request merged at an unexpected head' };
  }
  if (pullRequest.state === 'open' && pullRequest.head.sha === expectedSha) return { action: 'retry' };
  return { action: 'needs-human', reason: 'pull request closed or changed before merge was confirmed' };
}

export function reconcileAttempt(attempt, pullRequests) {
  const current = pullRequests.filter((pullRequest) => pullRequest.attempt === attempt &&
    (pullRequest.state === 'open' || pullRequest.merged_at));
  if (current.length > 1) return { action: 'needs-human', reason: 'multiple open pull requests exist for one attempt' };
  if (current.length === 1) return { action: 'adopt', pullRequest: current[0] };
  return { action: 'wait' };
}

export function reconcileReview({ reviewSha, reviewAt }, pullRequest, review) {
  if (!pullRequest || pullRequest.state !== 'open') return { action: 'retry-worker', reason: 'pull request is not open' };
  if (pullRequest.headSha !== reviewSha) return { action: 'retry-worker', reason: 'head changed after review lease' };
  if (review?.invalid) return { action: 'needs-human', reason: review.invalid };
  if (review && review.sha === reviewSha && review.at > reviewAt) return { action: 'complete', verdict: review.verdict };
  return { action: 'wait' };
}
