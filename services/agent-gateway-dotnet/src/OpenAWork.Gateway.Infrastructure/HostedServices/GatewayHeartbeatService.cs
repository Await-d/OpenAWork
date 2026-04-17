using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace OpenAWork.Gateway.Infrastructure.HostedServices;

public sealed class GatewayHeartbeatService(ILogger<GatewayHeartbeatService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("Gateway heartbeat service started.");

        while (!stoppingToken.IsCancellationRequested)
        {
            logger.LogDebug("Gateway heartbeat tick at {TimestampUtc}", DateTimeOffset.UtcNow);
            await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
        }
    }
}
