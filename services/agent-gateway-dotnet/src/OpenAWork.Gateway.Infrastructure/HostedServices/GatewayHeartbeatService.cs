using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using OpenAWork.Gateway.Application.Abstractions.Streaming;

namespace OpenAWork.Gateway.Infrastructure.HostedServices;

public sealed class GatewayHeartbeatService(
    IServiceScopeFactory scopeFactory,
    ILogger<GatewayHeartbeatService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("Gateway heartbeat service started.");

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await using var scope = scopeFactory.CreateAsyncScope();
                var reconciler = scope.ServiceProvider.GetRequiredService<ISessionRuntimeReconciler>();
                var result = await reconciler.ReconcileAllAsync(null, stoppingToken);
                logger.LogDebug(
                    "Gateway heartbeat tick at {TimestampUtc}; candidateCount={CandidateCount}, resetCount={ResetCount}, pausedCount={PausedCount}, failedCount={FailedCount}",
                    DateTimeOffset.UtcNow,
                    result.CandidateCount,
                    result.ResetCount,
                    result.PausedCount,
                    result.FailedSessionIds.Count);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                logger.LogError(exception, "Gateway heartbeat reconcile tick failed.");
            }

            await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
        }
    }
}
