using System.Diagnostics;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using OpenAWork.Gateway.Application.Abstractions.Observability;
using OpenAWork.Gateway.Contracts.Observability;
using OpenAWork.Gateway.Infrastructure.Observability;

namespace OpenAWork.Gateway.Infrastructure.Middleware;

public sealed class RequestWorkflowMiddleware(
    RequestDelegate next,
    ILogger<RequestWorkflowMiddleware> logger)
{
    public async Task InvokeAsync(
        HttpContext context,
        IRequestWorkflowTracker workflowTracker,
        IRequestWorkflowLogStore workflowLogStore)
    {
        var requestContext = CreateRequestContext(context);
        context.Response.Headers.TryAdd("x-request-id", requestContext.RequestId);

        using var activity = GatewayActivity.Source.StartActivity("request.handle", ActivityKind.Server);
        activity?.SetTag("http.method", requestContext.Method);
        activity?.SetTag("http.route", requestContext.Path);
        activity?.SetTag("request.id", requestContext.RequestId);

        var rootStep = new WorkflowStep
        {
            Name = "request.handle",
            Status = StepStatus.Pending,
            StartedAtUtc = DateTimeOffset.UtcNow,
            Fields = new Dictionary<string, string>
            {
                ["method"] = requestContext.Method,
                ["path"] = requestContext.Path,
            },
        };

        workflowTracker.Initialize(requestContext, rootStep);

        try
        {
            await next(context);
        }
        catch (Exception exception)
        {
            workflowTracker.Fail(rootStep, exception.Message);
            throw;
        }
        finally
        {
            workflowTracker.SettlePending(null, context.Response.StatusCode);

            var output = workflowTracker.Render(context.Response.StatusCode);
            if (!string.IsNullOrWhiteSpace(output))
            {
                logger.LogInformation("{Workflow}", output);
            }

            if (workflowTracker.CurrentContext is not null)
            {
                await workflowLogStore.PersistAsync(
                    workflowTracker.CurrentContext,
                    workflowTracker.Snapshot(),
                    context.Response.StatusCode,
                    ResolveUserId(context),
                    context.RequestAborted);
            }

            workflowTracker.Clear();
        }
    }

    private static RequestContext CreateRequestContext(HttpContext context)
    {
        var requestId = context.Request.Headers.TryGetValue("x-request-id", out var existingId)
            && !string.IsNullOrWhiteSpace(existingId)
            ? existingId.ToString()
            : $"{Guid.NewGuid():N}";

        var forwardedIp = context.Request.Headers.TryGetValue("x-forwarded-for", out var ipHeader)
            ? ipHeader.ToString().Split(',')[0]?.Trim()
            : null;

        return new RequestContext(
            RequestId: requestId,
            Method: context.Request.Method,
            Path: context.Request.Path.Value ?? "/",
            Ip: string.IsNullOrWhiteSpace(forwardedIp) ? context.Connection.RemoteIpAddress?.ToString() : forwardedIp,
            UserAgent: context.Request.Headers.UserAgent.ToString(),
            StartTimeUtc: DateTimeOffset.UtcNow);
    }

    private static string? ResolveUserId(HttpContext context) => context.User.FindFirst("sub")?.Value;
}
