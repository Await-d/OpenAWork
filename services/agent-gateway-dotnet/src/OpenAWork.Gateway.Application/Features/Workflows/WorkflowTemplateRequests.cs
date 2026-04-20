using System.Text.Json;
using MediatR;
using Microsoft.EntityFrameworkCore;
using OpenAWork.Gateway.Application.Abstractions.Auth;
using OpenAWork.Gateway.Application.Abstractions.Messaging;
using OpenAWork.Gateway.Contracts.Workflows;
using OpenAWork.Gateway.Persistence.EFCore;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.Application.Features.Workflows;

public sealed record GetWorkflowTemplatesQuery() : IQuery<IReadOnlyList<WorkflowTemplateResponse>>;

public sealed record CreateWorkflowTemplateCommand(
    string Name,
    string? Description,
    string Category,
    JsonElement Metadata,
    JsonElement Nodes,
    JsonElement Edges) : ICommand<WorkflowTemplateResponse>;

public sealed record DeleteWorkflowTemplateCommand(string TemplateId) : ICommand<Unit>;

public sealed class GetWorkflowTemplatesQueryHandler(
    ICurrentUser currentUser,
    GatewayDbContext dbContext) : IRequestHandler<GetWorkflowTemplatesQuery, IReadOnlyList<WorkflowTemplateResponse>>
{
    public async Task<IReadOnlyList<WorkflowTemplateResponse>> Handle(GetWorkflowTemplatesQuery request, CancellationToken cancellationToken)
    {
        var userId = WorkflowTemplateRequestGuards.RequireUserId(currentUser);

        var records = await dbContext.WorkflowTemplates
            .AsNoTracking()
            .Where((template) => template.UserId == userId)
            .OrderByDescending((template) => template.UpdatedAtUtc)
            .ToListAsync(cancellationToken);

        return records.Select(WorkflowTemplateSupport.Map).ToArray();
    }
}

public sealed class CreateWorkflowTemplateCommandHandler(
    ICurrentUser currentUser,
    GatewayDbContext dbContext) : IRequestHandler<CreateWorkflowTemplateCommand, WorkflowTemplateResponse>
{
    public async Task<WorkflowTemplateResponse> Handle(CreateWorkflowTemplateCommand request, CancellationToken cancellationToken)
    {
        var userId = WorkflowTemplateRequestGuards.RequireUserId(currentUser);
        var now = DateTimeOffset.UtcNow;

        var normalizedMetadata = WorkflowTemplateSupport.NormalizeMetadata(request.Category, request.Metadata);
        var record = new WorkflowTemplateRecord
        {
            Id = Guid.NewGuid().ToString(),
            UserId = userId,
            Name = request.Name,
            Description = request.Description,
            Category = request.Category,
            MetadataJson = WorkflowTemplateSupport.Serialize(normalizedMetadata),
            NodesJson = WorkflowTemplateSupport.Serialize(request.Nodes),
            EdgesJson = WorkflowTemplateSupport.Serialize(request.Edges),
            CreatedAtUtc = now,
            UpdatedAtUtc = now,
        };

        dbContext.WorkflowTemplates.Add(record);
        await dbContext.SaveChangesAsync(cancellationToken);
        return WorkflowTemplateSupport.Map(record);
    }
}

public sealed class DeleteWorkflowTemplateCommandHandler(
    ICurrentUser currentUser,
    GatewayDbContext dbContext) : IRequestHandler<DeleteWorkflowTemplateCommand, Unit>
{
    public async Task<Unit> Handle(DeleteWorkflowTemplateCommand request, CancellationToken cancellationToken)
    {
        var userId = WorkflowTemplateRequestGuards.RequireUserId(currentUser);
        var record = await dbContext.WorkflowTemplates
            .SingleOrDefaultAsync(
                (template) => template.Id == request.TemplateId && template.UserId == userId,
                cancellationToken);

        if (record is null)
        {
            throw new KeyNotFoundException("Template not found");
        }

        dbContext.WorkflowTemplates.Remove(record);
        await dbContext.SaveChangesAsync(cancellationToken);
        return Unit.Value;
    }
}

internal static class WorkflowTemplateRequestGuards
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
