using MediatR;
using Microsoft.EntityFrameworkCore;
using OpenAWork.Gateway.Application.Abstractions.Auth;
using OpenAWork.Gateway.Contracts.Usage;
using OpenAWork.Gateway.Persistence.EFCore;

namespace OpenAWork.Gateway.Application.Features.Usage;

public sealed class GetUsageBreakdownQueryHandler(
    ICurrentUser currentUser,
    GatewayDbContext dbContext) : IRequestHandler<GetUsageBreakdownQuery, UsageBreakdownResponse>
{
    public async Task<UsageBreakdownResponse> Handle(GetUsageBreakdownQuery request, CancellationToken cancellationToken)
    {
        var userId = RequireUserId();
        var currentMonth = DateTimeOffset.UtcNow.ToString("yyyy-MM");

        var row = await dbContext.UsageRecords
            .AsNoTracking()
            .Where((record) => record.UserId == userId && record.Month == currentMonth)
            .Select((record) => record.CostUsd)
            .SingleOrDefaultAsync(cancellationToken);

        return new UsageBreakdownResponse(row, Array.Empty<CostBreakdownItemResponse>());
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
