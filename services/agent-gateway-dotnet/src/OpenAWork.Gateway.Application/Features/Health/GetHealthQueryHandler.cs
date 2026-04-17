using MediatR;
using OpenAWork.Gateway.Contracts.Health;

namespace OpenAWork.Gateway.Application.Features.Health;

public sealed class GetHealthQueryHandler : IRequestHandler<GetHealthQuery, HealthResponse>
{
    public Task<HealthResponse> Handle(GetHealthQuery request, CancellationToken cancellationToken)
    {
        return Task.FromResult(new HealthResponse(
            Status: "healthy",
            Service: "OpenAWork.Gateway.DotNet",
            Provider: "skeleton",
            TimestampUtc: DateTimeOffset.UtcNow));
    }
}
