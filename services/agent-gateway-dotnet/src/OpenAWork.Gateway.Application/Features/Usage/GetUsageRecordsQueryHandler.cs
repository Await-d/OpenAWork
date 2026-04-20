using MediatR;
using Microsoft.EntityFrameworkCore;
using OpenAWork.Gateway.Application.Abstractions.Auth;
using OpenAWork.Gateway.Contracts.Usage;
using OpenAWork.Gateway.Persistence.EFCore;

namespace OpenAWork.Gateway.Application.Features.Usage;

public sealed class GetUsageRecordsQueryHandler(
    ICurrentUser currentUser,
    GatewayDbContext dbContext) : IRequestHandler<GetUsageRecordsQuery, UsageRecordsResponse>
{
    public async Task<UsageRecordsResponse> Handle(GetUsageRecordsQuery request, CancellationToken cancellationToken)
    {
        var userId = RequireUserId();

        var records = await dbContext.UsageRecords
            .AsNoTracking()
            .Where((record) => record.UserId == userId)
            .OrderByDescending((record) => record.Month)
            .Take(12)
            .Select((record) => new UsageRecordResponse(
                record.Month,
                record.CostUsd,
                record.InputTokens,
                record.OutputTokens,
                new Dictionary<string, decimal>()))
            .ToListAsync(cancellationToken);

        var budgetRaw = await dbContext.UserSettings
            .AsNoTracking()
            .Where((setting) => setting.UserId == userId && setting.Key == "budget_usd")
            .Select((setting) => setting.Value)
            .SingleOrDefaultAsync(cancellationToken);

        var budget = decimal.TryParse(budgetRaw, out var parsedBudget) ? parsedBudget : 20m;
        return new UsageRecordsResponse(records, budget);
    }

    private string RequireUserId()
    {
        if (!currentUser.IsAuthenticated || string.IsNullOrWhiteSpace(currentUser.UserId))
        {
            throw new UnauthorizedAccessException("Authenticated user is required.");
        }

        return currentUser.UserId;
    }
}
