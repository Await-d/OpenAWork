using MediatR;
using Microsoft.Extensions.Logging;
using OpenAWork.Gateway.Application.Abstractions.Observability;

namespace OpenAWork.Gateway.Application.Behaviors;

public sealed class LoggingBehavior<TRequest, TResponse>(
    ILogger<LoggingBehavior<TRequest, TResponse>> logger,
    IRequestWorkflowTracker workflowTracker) : IPipelineBehavior<TRequest, TResponse>
    where TRequest : notnull
{
    public async Task<TResponse> Handle(
        TRequest request,
        RequestHandlerDelegate<TResponse> next,
        CancellationToken cancellationToken)
    {
        var step = workflowTracker.RootStep is null
            ? null
            : workflowTracker.StartChild(
                workflowTracker.RootStep,
                $"mediatr.{typeof(TRequest).Name}",
                fields: new Dictionary<string, string>
                {
                    ["requestType"] = typeof(TRequest).FullName ?? typeof(TRequest).Name,
                });

        logger.LogInformation("Handling request {RequestType}", typeof(TRequest).FullName ?? typeof(TRequest).Name);

        try
        {
            var response = await next();
            if (step is not null)
            {
                workflowTracker.Succeed(step, "request handled");
            }

            return response;
        }
        catch (Exception exception)
        {
            if (step is not null)
            {
                workflowTracker.Fail(step, exception.Message);
            }

            logger.LogError(exception, "Unhandled request error for {RequestType}", typeof(TRequest).FullName ?? typeof(TRequest).Name);
            throw;
        }
    }
}
