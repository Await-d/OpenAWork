using MediatR;
using OpenAWork.Gateway.Application.Abstractions.Auth;
using OpenAWork.Gateway.Application.Abstractions.Messaging;
using OpenAWork.Gateway.Application.Abstractions.Persistence;
using OpenAWork.Gateway.Contracts.Agents;
using OpenAWork.Gateway.Contracts.Capabilities;

namespace OpenAWork.Gateway.Application.Features.Agents;

public sealed record GetManagedAgentsQuery() : IQuery<ManagedAgentsResponse>;

public sealed record CreateManagedAgentCommand(
    string? Id,
    string Label,
    string Description,
    IReadOnlyList<string> Aliases,
    CanonicalRoleResponse? CanonicalRole,
    string? Model,
    string? Variant,
    IReadOnlyList<string> FallbackModels,
    string SystemPrompt,
    string? Note,
    bool? Enabled) : ICommand<ManagedAgentEnvelopeResponse>;

public sealed record UpdateManagedAgentCommand(
    string AgentId,
    string? Label,
    string? Description,
    IReadOnlyList<string>? Aliases,
    CanonicalRoleResponse? CanonicalRole,
    string? Model,
    string? Variant,
    IReadOnlyList<string>? FallbackModels,
    string? SystemPrompt,
    string? Note,
    bool? Enabled) : ICommand<ManagedAgentEnvelopeResponse>;

public sealed record RemoveManagedAgentCommand(string AgentId) : ICommand<Unit>;

public sealed record ResetManagedAgentCommand(string AgentId) : ICommand<ManagedAgentEnvelopeResponse>;

public sealed record ResetAllManagedAgentsCommand() : ICommand<ManagedAgentsResponse>;

public sealed class GetManagedAgentsQueryHandler(
    ICurrentUser currentUser,
    IUserSettingsReader userSettingsReader) : IRequestHandler<GetManagedAgentsQuery, ManagedAgentsResponse>
{
    public Task<ManagedAgentsResponse> Handle(GetManagedAgentsQuery request, CancellationToken cancellationToken)
    {
        return ManagedAgentCatalog.ListAsync(ManagedAgentRequestGuards.RequireUserId(currentUser), userSettingsReader, cancellationToken);
    }
}

public sealed class CreateManagedAgentCommandHandler(
    ICurrentUser currentUser,
    IUserSettingsReader userSettingsReader,
    IUserSettingsWriter userSettingsWriter) : IRequestHandler<CreateManagedAgentCommand, ManagedAgentEnvelopeResponse>
{
    public async Task<ManagedAgentEnvelopeResponse> Handle(CreateManagedAgentCommand request, CancellationToken cancellationToken)
    {
        var agent = await ManagedAgentCatalog.CreateAsync(
            ManagedAgentRequestGuards.RequireUserId(currentUser),
            request,
            userSettingsReader,
            userSettingsWriter,
            cancellationToken);
        return new ManagedAgentEnvelopeResponse(agent);
    }
}

public sealed class UpdateManagedAgentCommandHandler(
    ICurrentUser currentUser,
    IUserSettingsReader userSettingsReader,
    IUserSettingsWriter userSettingsWriter) : IRequestHandler<UpdateManagedAgentCommand, ManagedAgentEnvelopeResponse>
{
    public async Task<ManagedAgentEnvelopeResponse> Handle(UpdateManagedAgentCommand request, CancellationToken cancellationToken)
    {
        var agent = await ManagedAgentCatalog.UpdateAsync(
            ManagedAgentRequestGuards.RequireUserId(currentUser),
            request,
            userSettingsReader,
            userSettingsWriter,
            cancellationToken);
        return new ManagedAgentEnvelopeResponse(agent);
    }
}

public sealed class RemoveManagedAgentCommandHandler(
    ICurrentUser currentUser,
    IUserSettingsReader userSettingsReader,
    IUserSettingsWriter userSettingsWriter) : IRequestHandler<RemoveManagedAgentCommand, Unit>
{
    public async Task<Unit> Handle(RemoveManagedAgentCommand request, CancellationToken cancellationToken)
    {
        await ManagedAgentCatalog.RemoveAsync(
            ManagedAgentRequestGuards.RequireUserId(currentUser),
            request.AgentId,
            userSettingsReader,
            userSettingsWriter,
            cancellationToken);
        return Unit.Value;
    }
}

public sealed class ResetManagedAgentCommandHandler(
    ICurrentUser currentUser,
    IUserSettingsReader userSettingsReader,
    IUserSettingsWriter userSettingsWriter) : IRequestHandler<ResetManagedAgentCommand, ManagedAgentEnvelopeResponse>
{
    public async Task<ManagedAgentEnvelopeResponse> Handle(ResetManagedAgentCommand request, CancellationToken cancellationToken)
    {
        var agent = await ManagedAgentCatalog.ResetAsync(
            ManagedAgentRequestGuards.RequireUserId(currentUser),
            request.AgentId,
            userSettingsReader,
            userSettingsWriter,
            cancellationToken);
        return new ManagedAgentEnvelopeResponse(agent);
    }
}

public sealed class ResetAllManagedAgentsCommandHandler(
    ICurrentUser currentUser,
    IUserSettingsReader userSettingsReader,
    IUserSettingsWriter userSettingsWriter) : IRequestHandler<ResetAllManagedAgentsCommand, ManagedAgentsResponse>
{
    public Task<ManagedAgentsResponse> Handle(ResetAllManagedAgentsCommand request, CancellationToken cancellationToken)
    {
        return ManagedAgentCatalog.ResetAllAsync(
            ManagedAgentRequestGuards.RequireUserId(currentUser),
            userSettingsReader,
            userSettingsWriter,
            cancellationToken);
    }
}

internal static class ManagedAgentRequestGuards
{
    internal static string RequireUserId(ICurrentUser currentUser)
    {
        if (!currentUser.IsAuthenticated || string.IsNullOrWhiteSpace(currentUser.UserId))
        {
            throw new UnauthorizedAccessException("Authenticated user is required.");
        }

        return currentUser.UserId;
    }
}
