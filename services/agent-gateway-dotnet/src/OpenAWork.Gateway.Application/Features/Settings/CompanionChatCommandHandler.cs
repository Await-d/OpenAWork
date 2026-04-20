using MediatR;
using OpenAWork.Gateway.Application.Abstractions.Auth;
using OpenAWork.Gateway.Application.Abstractions.Persistence;
using OpenAWork.Gateway.Application.Abstractions.Settings;
using OpenAWork.Gateway.Contracts.Settings;

namespace OpenAWork.Gateway.Application.Features.Settings;

public sealed class CompanionChatCommandHandler(
    ICurrentUser currentUser,
    IUserSettingsReader userSettingsReader,
    IWorkflowLlmClient workflowLlmClient) : IRequestHandler<CompanionChatCommand, CompanionChatResponse>
{
    public async Task<CompanionChatResponse> Handle(CompanionChatCommand request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Request.ApiBaseUrl) || string.IsNullOrWhiteSpace(request.Request.ApiKey))
        {
            throw new InvalidOperationException("Companion chat LLM is not configured");
        }

        var (userId, email) = RequireUser();
        var stored = await userSettingsReader.GetValueAsync(userId, CompanionSettingsSupport.SettingsKey, cancellationToken);
        var settings = CompanionSettingsSupport.Load(stored, email, request.Request.AgentId);
        var prompt = CompanionSettingsSupport.BuildChatPrompt(settings, request.Request);
        if (prompt is null)
        {
            return new CompanionChatResponse(string.Empty, settings.Profile.Name, settings.Profile.Species, "chat");
        }

        var response = await workflowLlmClient.CompleteAsync(request.Request.ApiBaseUrl!, request.Request.ApiKey!, request.Request.Model, prompt, 0.7, cancellationToken);
        return new CompanionChatResponse(response.Trim(), settings.Profile.Name, settings.Profile.Species, "chat");
    }

    private (string UserId, string Email) RequireUser()
    {
        if (!currentUser.IsAuthenticated || string.IsNullOrWhiteSpace(currentUser.UserId) || string.IsNullOrWhiteSpace(currentUser.Email))
        {
            throw new UnauthorizedAccessException("Authenticated user is required.");
        }

        return (currentUser.UserId, currentUser.Email);
    }
}
