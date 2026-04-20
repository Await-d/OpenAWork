using System.Text.Json;
using System.Text.RegularExpressions;
using MediatR;
using OpenAWork.Gateway.Application.Abstractions.Messaging;
using OpenAWork.Gateway.Application.Abstractions.Settings;
using OpenAWork.Gateway.Contracts.Workflows;

namespace OpenAWork.Gateway.Application.Features.Workflows;

public sealed record OptimizePromptCommand(
    string OriginalPrompt,
    string? Context,
    string? TargetAudience,
    int CandidateCount,
    string ApiBaseUrl,
    string ApiKey,
    string Model) : ICommand<PromptOptimizerResponse>;

public sealed record TranslateWorkflowTaskCommand(
    string Id,
    string Content,
    string FileName,
    string SourceLanguage,
    string TargetLanguage);

public sealed record TranslateWorkflowCommand(
    IReadOnlyList<TranslateWorkflowTaskCommand> Tasks,
    string ApiBaseUrl,
    string ApiKey,
    string Model) : ICommand<TranslationResultsResponse>;

public sealed class OptimizePromptCommandHandler(
    IWorkflowLlmClient workflowLlmClient) : IRequestHandler<OptimizePromptCommand, PromptOptimizerResponse>
{
    public async Task<PromptOptimizerResponse> Handle(OptimizePromptCommand request, CancellationToken cancellationToken)
    {
        var prompt = BuildOptimizerPrompt(request);
        var raw = await workflowLlmClient.CompleteAsync(
            request.ApiBaseUrl,
            request.ApiKey,
            request.Model,
            prompt,
            0.7,
            cancellationToken);

        var jsonMatch = Regex.Match(raw, "\\{[\\s\\S]*\\}");
        if (!jsonMatch.Success)
        {
            throw new InvalidOperationException("LLM returned no JSON payload from prompt optimizer");
        }

        using var document = JsonDocument.Parse(jsonMatch.Value);
        var root = document.RootElement;
        var candidates = root.TryGetProperty("candidates", out var candidatesElement) && candidatesElement.ValueKind == JsonValueKind.Array
            ? candidatesElement.EnumerateArray().Select((candidate) => new PromptCandidateResponse(
                Id: WorkflowLlmRequestSupport.ReadString(candidate, "id") ?? Guid.NewGuid().ToString("N"),
                Text: WorkflowLlmRequestSupport.ReadString(candidate, "text") ?? string.Empty,
                Improvements: candidate.TryGetProperty("improvements", out var improvementsElement) && improvementsElement.ValueKind == JsonValueKind.Array
                    ? improvementsElement.EnumerateArray().Where((item) => item.ValueKind == JsonValueKind.String).Select((item) => item.GetString() ?? string.Empty).Where((item) => item.Length > 0).ToArray()
                    : Array.Empty<string>(),
                Score: candidate.TryGetProperty("score", out var scoreElement) && scoreElement.ValueKind == JsonValueKind.Number && scoreElement.TryGetDouble(out var score)
                    ? score
                    : null))
                .ToArray()
            : Array.Empty<PromptCandidateResponse>();

        return new PromptOptimizerResponse(
            RequestId: Guid.NewGuid().ToString(),
            OriginalPrompt: request.OriginalPrompt,
            Candidates: candidates,
            Recommended: root.TryGetProperty("recommended", out var recommendedElement) && recommendedElement.ValueKind == JsonValueKind.String
                ? recommendedElement.GetString() ?? string.Empty
                : string.Empty,
            Rationale: root.TryGetProperty("rationale", out var rationaleElement) && rationaleElement.ValueKind == JsonValueKind.String
                ? rationaleElement.GetString() ?? string.Empty
                : string.Empty,
            CompletedAt: DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
    }

    private static string BuildOptimizerPrompt(OptimizePromptCommand request)
    {
        var systemCtx = string.IsNullOrWhiteSpace(request.Context) ? string.Empty : $"\nOptimization context: {request.Context}";
        var audience = string.IsNullOrWhiteSpace(request.TargetAudience) ? string.Empty : $"\nTarget audience: {request.TargetAudience}";

        return string.Join('\n',
        [
            $"You are an expert prompt engineer specializing in optimizing prompts for large language models. Your task is to generate {request.CandidateCount} improved versions of the given prompt by applying the following optimization dimensions:",
            string.Empty,
            "## Optimization Dimensions",
            "1. **Specificity & Clarity**: Eliminate ambiguity. Replace vague words with precise, measurable instructions. Clearly articulate the desired outcome.",
            "2. **Professional Terminology**: Convert colloquial or informal expressions into domain-specific professional terms. Use industry-standard vocabulary that LLMs understand precisely.",
            "3. **Structured Format**: Apply structured prompt patterns (similar to LangGPT). When appropriate, organize the prompt with clear sections: Role/角色, Skills/技能, Constraints/约束, Output Format/输出格式, Workflow/工作流程.",
            "4. **Task Decomposition**: Break complex requests into sequential steps or subtasks. Use numbered steps or bullet points for clarity.",
            "5. **Constraints & Guardrails**: Add explicit constraints (what NOT to do), output format requirements, and quality criteria.",
            "6. **Chain-of-Thought Triggering**: When the task involves reasoning, analysis, or multi-step logic, add \"think step-by-step\" or \"reason through this systematically\" cues.",
            string.Empty,
            "## Optimization Strategy",
            "- Candidate 1: Focus on **clarity + professional terminology** — make the prompt precise and domain-appropriate while keeping its original intent.",
            "- Candidate 2: Focus on **structured format + task decomposition** — restructure the prompt with clear sections and step-by-step instructions.",
            "- Candidate 3 (if count ≥ 3): Apply **all dimensions** comprehensively — the most thorough optimization combining clarity, structure, constraints, and reasoning cues.",
            "- Additional candidates: Vary the balance of dimensions to offer alternative optimization styles.",
            string.Empty,
            "## Rules",
            "- Preserve the user's original intent completely. Do NOT change what the user is asking for.",
            "- The optimized prompt should be in the SAME language as the original (Chinese→Chinese, English→English, etc.).",
            "- Each candidate must include a list of specific improvements made (the \"improvements\" array).",
            "- improvements should be short descriptive labels like \"专业术语替换\", \"添加步骤分解\", \"增加输出格式约束\", \"消除歧义\", etc.",
            systemCtx,
            audience,
            string.Empty,
            "## Output Format",
            "Return a JSON object with keys:",
            "- candidates: array of { id: string, text: string, improvements: string[] }",
            "- recommended: id of the best candidate (the one that most effectively improves the prompt while preserving intent)",
            "- rationale: one sentence explaining why the recommended candidate is best",
            string.Empty,
            "## Original Prompt to Optimize",
            request.OriginalPrompt,
        ]);
    }
}

public sealed class TranslateWorkflowCommandHandler(
    IWorkflowLlmClient workflowLlmClient) : IRequestHandler<TranslateWorkflowCommand, TranslationResultsResponse>
{
    public async Task<TranslationResultsResponse> Handle(TranslateWorkflowCommand request, CancellationToken cancellationToken)
    {
        var results = await Task.WhenAll(request.Tasks.Select((task) => TranslateSingleAsync(task, request, cancellationToken)));
        return new TranslationResultsResponse(results);
    }

    private async Task<TranslationResultResponse> TranslateSingleAsync(
        TranslateWorkflowTaskCommand task,
        TranslateWorkflowCommand request,
        CancellationToken cancellationToken)
    {
        var prompt = string.Join('\n',
        [
            $"Translate the following {task.SourceLanguage} text to {task.TargetLanguage}.",
            "Return ONLY the translated text with no additional explanation.",
            $"File: {task.FileName}",
            string.Empty,
            task.Content,
        ]);

        var translated = await workflowLlmClient.CompleteAsync(
            request.ApiBaseUrl,
            request.ApiKey,
            request.Model,
            prompt,
            0.3,
            cancellationToken);

        return new TranslationResultResponse(
            TaskId: task.Id,
            TranslatedContent: translated.Trim(),
            GlossaryMatches: null,
            Status: "completed",
            CompletedAt: DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
    }
}

internal static class WorkflowLlmRequestSupport
{
    internal static string? ReadString(JsonElement element, string propertyName)
        => element.TryGetProperty(propertyName, out var property) && property.ValueKind == JsonValueKind.String
            ? property.GetString()
            : null;
}
