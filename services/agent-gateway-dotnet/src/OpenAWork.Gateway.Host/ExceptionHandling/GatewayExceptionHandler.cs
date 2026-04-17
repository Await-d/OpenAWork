using FluentValidation;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;

namespace OpenAWork.Gateway.Host.ExceptionHandling;

public sealed class GatewayExceptionHandler(ILogger<GatewayExceptionHandler> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        logger.LogError(exception, "Unhandled gateway exception");

        if (exception is ValidationException validationException)
        {
            var validationErrors = validationException.Errors
                .GroupBy((failure) => failure.PropertyName)
                .ToDictionary(
                    (group) => group.Key,
                    (group) => group.Select((failure) => failure.ErrorMessage).ToArray());

            var problemDetails = new HttpValidationProblemDetails(validationErrors)
            {
                Title = "Validation failed.",
                Status = StatusCodes.Status400BadRequest,
                Type = "https://openawork.dev/problems/validation",
            };

            httpContext.Response.StatusCode = StatusCodes.Status400BadRequest;
            await httpContext.Response.WriteAsJsonAsync(problemDetails, cancellationToken);
            return true;
        }

        if (exception is UnauthorizedAccessException unauthorizedAccessException)
        {
            var unauthorizedProblem = new ProblemDetails
            {
                Title = "Unauthorized.",
                Status = StatusCodes.Status401Unauthorized,
                Type = "https://openawork.dev/problems/unauthorized",
                Detail = unauthorizedAccessException.Message,
            };

            httpContext.Response.StatusCode = StatusCodes.Status401Unauthorized;
            await httpContext.Response.WriteAsJsonAsync(unauthorizedProblem, cancellationToken);
            return true;
        }

        var problem = new ProblemDetails
        {
            Title = "Gateway request failed.",
            Status = StatusCodes.Status500InternalServerError,
            Type = "https://openawork.dev/problems/gateway-unhandled",
            Detail = exception.Message,
        };

        httpContext.Response.StatusCode = StatusCodes.Status500InternalServerError;
        await httpContext.Response.WriteAsJsonAsync(problem, cancellationToken);
        return true;
    }
}
