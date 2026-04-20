namespace OpenAWork.Gateway.Contracts.Workflows;

public sealed record PromptCandidateResponse(
    string Id,
    string Text,
    IReadOnlyList<string> Improvements,
    double? Score);

public sealed record PromptOptimizerResponse(
    string RequestId,
    string OriginalPrompt,
    IReadOnlyList<PromptCandidateResponse> Candidates,
    string Recommended,
    string Rationale,
    long CompletedAt);

public sealed record TranslationResultResponse(
    string TaskId,
    string TranslatedContent,
    int? GlossaryMatches,
    string Status,
    long CompletedAt);

public sealed record TranslationResultsResponse(IReadOnlyList<TranslationResultResponse> Results);
