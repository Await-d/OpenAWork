using System.Text.Json;
using System.Text.RegularExpressions;
using FluentValidation;
using MediatR;
using OpenAWork.Gateway.Application.Features.Auth;
using OpenAWork.Gateway.Domain.Errors;

namespace OpenAWork.Gateway.Host.Routes;

public static class AuthRouteGroupExtensions
{
    private const int MaxAuthBodyBytes = 16 * 1024;
    private const int MaxEmailLength = 320;
    private const int MaxPasswordLength = 1024;
    private const int MaxRefreshTokenLength = 4096;

    private static readonly Regex TsCompatibleEmailRegex = new(
        "^(?!.*\\.\\.)(?!\\.)(?!.*\\.$)[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\\.)+[A-Za-z]{2,63}$",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    public static IEndpointRouteBuilder MapAuthRoutes(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/auth").RequireRateLimiting("auth");

        group.MapPost("/login", async (HttpContext context, ISender sender, CancellationToken cancellationToken) =>
        {
            var bodyResult = await ReadRequestBodyAsJsonAsync(context, cancellationToken);
            if (!bodyResult.Success)
            {
                return bodyResult.ErrorResult!;
            }

            if (!TryParseCredentialsBody(bodyResult.Body!.Value, out var email, out var password, out var issues))
            {
                SetNoStore(context.Response);
                return Results.Json(new { error = "Invalid input", issues }, statusCode: StatusCodes.Status400BadRequest);
            }

            return await ExecuteAsync(
                context,
                () => sender.Send(new LoginCommand(email!, password!), cancellationToken),
                StatusCodes.Status200OK);
        });

        group.MapPost("/refresh", async (HttpContext context, ISender sender, CancellationToken cancellationToken) =>
        {
            var bodyResult = await ReadRequestBodyAsJsonAsync(context, cancellationToken);
            if (!bodyResult.Success)
            {
                return bodyResult.ErrorResult!;
            }

            if (!TryParseRefreshBody(bodyResult.Body!.Value, out var refreshToken, out var invalidInputResult))
            {
                SetNoStore(context.Response);
                return invalidInputResult!;
            }

            return await ExecuteAsync(
                context,
                () => sender.Send(new RefreshAccessTokenCommand(refreshToken!), cancellationToken),
                StatusCodes.Status200OK);
        });

        group.MapPost("/register", async (HttpContext context, ISender sender, CancellationToken cancellationToken) =>
        {
            var bodyResult = await ReadRequestBodyAsJsonAsync(context, cancellationToken);
            if (!bodyResult.Success)
            {
                return bodyResult.ErrorResult!;
            }

            if (!TryParseCredentialsBody(bodyResult.Body!.Value, out var email, out var password, out var issues))
            {
                SetNoStore(context.Response);
                return Results.Json(new { error = "Invalid input", issues }, statusCode: StatusCodes.Status400BadRequest);
            }

            return await ExecuteAsync(
                context,
                () => sender.Send(new RegisterCommand(email!, password!), cancellationToken),
                StatusCodes.Status201Created);
        });

        group.MapPost("/logout", async (HttpContext context, ISender sender, CancellationToken cancellationToken) =>
            await ExecuteAsync(
                context,
                () => sender.Send(new LogoutCurrentUserCommand(), cancellationToken),
                StatusCodes.Status200OK));

        return endpoints;
    }

    private static async Task<IResult> ExecuteAsync<TResponse>(
        HttpContext context,
        Func<Task<TResponse>> action,
        int successStatusCode)
    {
        SetNoStore(context.Response);

        try
        {
            var response = await action();
            return Results.Json(response, statusCode: successStatusCode);
        }
        catch (ValidationException validationException)
        {
            return Results.Json(new
            {
                error = "Invalid input",
                issues = validationException.Errors.Select((error) => new
                {
                    code = error.ErrorCode,
                    path = new[] { ToCamelCasePath(error.PropertyName) },
                    message = error.ErrorMessage,
                }),
            }, statusCode: StatusCodes.Status400BadRequest);
        }
        catch (GatewayConflictException conflictException)
        {
            return Results.Json(new { error = conflictException.Message }, statusCode: StatusCodes.Status409Conflict);
        }
        catch (UnauthorizedAccessException unauthorizedAccessException)
        {
            return Results.Json(new { error = unauthorizedAccessException.Message }, statusCode: StatusCodes.Status401Unauthorized);
        }
    }

    private static async Task<JsonBodyReadResult> ReadRequestBodyAsJsonAsync(HttpContext context, CancellationToken cancellationToken)
    {
        SetNoStore(context.Response);

        if (context.Request.ContentLength is > MaxAuthBodyBytes)
        {
            return JsonBodyReadResult.FromError(Results.Json(new { error = "Payload too large" }, statusCode: StatusCodes.Status413PayloadTooLarge));
        }

        await using var memoryStream = new MemoryStream(capacity: MaxAuthBodyBytes);
        var buffer = new byte[4096];
        var totalBytes = 0;

        while (true)
        {
            var read = await context.Request.Body.ReadAsync(buffer.AsMemory(), cancellationToken);
            if (read == 0)
            {
                break;
            }

            totalBytes += read;
            if (totalBytes > MaxAuthBodyBytes)
            {
                return JsonBodyReadResult.FromError(Results.Json(new { error = "Payload too large" }, statusCode: StatusCodes.Status413PayloadTooLarge));
            }

            await memoryStream.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
        }

        if (totalBytes == 0)
        {
            return JsonBodyReadResult.FromBody(default);
        }

        try
        {
            memoryStream.Position = 0;
            using var document = await JsonDocument.ParseAsync(memoryStream, cancellationToken: cancellationToken);
            return JsonBodyReadResult.FromBody(document.RootElement.Clone());
        }
        catch (JsonException)
        {
            return JsonBodyReadResult.FromError(Results.Json(
                new { error = "Invalid input", issues = new[] { CreateInvalidTypeIssue(Array.Empty<string>(), "object", "invalid_json") } },
                statusCode: StatusCodes.Status400BadRequest));
        }
    }

    private static bool TryParseCredentialsBody(JsonElement body, out string? email, out string? password, out List<object> issues)
    {
        email = null;
        password = null;
        issues = [];

        if (body.ValueKind != JsonValueKind.Object)
        {
            issues.Add(CreateInvalidTypeIssue([], "object", DescribeJsonKind(body.ValueKind)));
            return false;
        }

        email = ReadStringField(body, "email", issues, MaxEmailLength);
        password = ReadStringField(body, "password", issues, MaxPasswordLength);

        if (email is not null && !IsValidEmail(email))
        {
            issues.Add(new
            {
                validation = "email",
                code = "invalid_string",
                path = new[] { "email" },
                message = "Invalid email",
            });
        }

        if (password is not null && password.Length < 8)
        {
            issues.Add(new
            {
                code = "too_small",
                minimum = 8,
                type = "string",
                inclusive = true,
                exact = false,
                path = new[] { "password" },
                message = "String must contain at least 8 character(s)",
            });
        }

        return issues.Count == 0;
    }

    private static bool TryParseRefreshBody(JsonElement body, out string? refreshToken, out IResult? invalidInputResult)
    {
        refreshToken = null;
        invalidInputResult = null;

        if (body.ValueKind != JsonValueKind.Object)
        {
            invalidInputResult = Results.Json(
                new { error = "Invalid input", issues = new[] { CreateInvalidTypeIssue(Array.Empty<string>(), "object", DescribeJsonKind(body.ValueKind)) } },
                statusCode: StatusCodes.Status400BadRequest);
            return false;
        }

        if (!body.TryGetProperty("refreshToken", out var refreshTokenElement))
        {
            invalidInputResult = Results.Json(new { error = "refreshToken required" }, statusCode: StatusCodes.Status400BadRequest);
            return false;
        }

        if (refreshTokenElement.ValueKind == JsonValueKind.Null)
        {
            invalidInputResult = Results.Json(new
            {
                error = "Invalid input",
                issues = new[] { CreateInvalidTypeIssue(new[] { "refreshToken" }, "string", "null") },
            }, statusCode: StatusCodes.Status400BadRequest);
            return false;
        }

        if (refreshTokenElement.ValueKind != JsonValueKind.String)
        {
            invalidInputResult = Results.Json(new
            {
                error = "Invalid input",
                issues = new[] { CreateInvalidTypeIssue(new[] { "refreshToken" }, "string", DescribeJsonKind(refreshTokenElement.ValueKind)) },
            }, statusCode: StatusCodes.Status400BadRequest);
            return false;
        }

        refreshToken = refreshTokenElement.GetString();
        if (refreshToken is not null && refreshToken.Length > MaxRefreshTokenLength)
        {
            invalidInputResult = Results.Json(new
            {
                error = "Invalid input",
                issues = new[]
                {
                    new
                    {
                        code = "too_big",
                        maximum = MaxRefreshTokenLength,
                        type = "string",
                        inclusive = true,
                        exact = false,
                        path = new[] { "refreshToken" },
                        message = $"String must contain at most {MaxRefreshTokenLength} character(s)",
                    },
                },
            }, statusCode: StatusCodes.Status400BadRequest);
            return false;
        }

        return true;
    }

    private static string? ReadStringField(JsonElement body, string propertyName, List<object> issues, int maxLength)
    {
        if (!body.TryGetProperty(propertyName, out var element))
        {
            issues.Add(CreateInvalidTypeIssue(new[] { propertyName }, "string", "undefined"));
            return null;
        }

        if (element.ValueKind == JsonValueKind.Null)
        {
            issues.Add(CreateInvalidTypeIssue(new[] { propertyName }, "string", "null"));
            return null;
        }

        if (element.ValueKind != JsonValueKind.String)
        {
            issues.Add(CreateInvalidTypeIssue(new[] { propertyName }, "string", DescribeJsonKind(element.ValueKind)));
            return null;
        }

        var value = element.GetString();
        if (value is not null && value.Length > maxLength)
        {
            issues.Add(new
            {
                code = "too_big",
                maximum = maxLength,
                type = "string",
                inclusive = true,
                exact = false,
                path = new[] { propertyName },
                message = $"String must contain at most {maxLength} character(s)",
            });
        }

        return value;
    }

    private static object CreateInvalidTypeIssue(string[] path, string expected, string received) => new
    {
        code = "invalid_type",
        expected,
        received,
        path,
        message = "Required",
    };

    private static string DescribeJsonKind(JsonValueKind kind) => kind switch
    {
        JsonValueKind.String => "string",
        JsonValueKind.Number => "number",
        JsonValueKind.True or JsonValueKind.False => "boolean",
        JsonValueKind.Object => "object",
        JsonValueKind.Array => "array",
        JsonValueKind.Null => "null",
        JsonValueKind.Undefined => "undefined",
        _ => "unknown",
    };

    private static void SetNoStore(HttpResponse response)
    {
        response.Headers.CacheControl = "no-store";
        response.Headers.Pragma = "no-cache";
    }

    private static bool IsValidEmail(string email)
    {
        return !string.IsNullOrWhiteSpace(email)
            && email.Length <= MaxEmailLength
            && TsCompatibleEmailRegex.IsMatch(email);
    }

    private static string ToCamelCasePath(string propertyName)
    {
        if (string.IsNullOrEmpty(propertyName))
        {
            return string.Empty;
        }

        return char.ToLowerInvariant(propertyName[0]) + propertyName[1..];
    }

    private readonly record struct JsonBodyReadResult(bool Success, JsonElement? Body, IResult? ErrorResult)
    {
        public static JsonBodyReadResult FromBody(JsonElement body) => new(true, body, null);

        public static JsonBodyReadResult FromError(IResult errorResult) => new(false, null, errorResult);
    }
}
