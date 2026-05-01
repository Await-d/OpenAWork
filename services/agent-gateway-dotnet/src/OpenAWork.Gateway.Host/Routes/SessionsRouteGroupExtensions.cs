using System.Text.Json;
using MediatR;
using OpenAWork.Gateway.Application.Features.Sessions;

namespace OpenAWork.Gateway.Host.Routes;

public static class SessionsRouteGroupExtensions
{
    public static IEndpointRouteBuilder MapSessionsRoutes(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/sessions").RequireAuthorization();

        group.MapPost(string.Empty, async Task<IResult> (JsonElement body, ISender sender, CancellationToken cancellationToken) =>
        {
            if (!TryParseCreateBody(body, out var command, out var issues))
            {
                return Results.Json(new { error = "Invalid input", issues }, statusCode: StatusCodes.Status400BadRequest);
            }

            try
            {
                var response = await sender.Send(command!, cancellationToken);
                return Results.Json(response, statusCode: StatusCodes.Status201Created);
            }
            catch (SessionRequestValidationException exception)
            {
                return Results.Json(
                    exception.Issues is { Count: > 0 }
                        ? new { error = exception.Error, issues = exception.Issues }
                        : new { error = exception.Error },
                    statusCode: exception.StatusCode);
            }
        });

        group.MapGet(string.Empty, async Task<IResult> (HttpRequest request, ISender sender, CancellationToken cancellationToken) =>
        {
            if (!TryParseListQuery(request.Query, out var query, out var error))
            {
                return Results.Json(new { error = error }, statusCode: StatusCodes.Status400BadRequest);
            }

            var response = await sender.Send(query!, cancellationToken);
            return Results.Ok(response);
        });

        group.MapGet("/search", async Task<IResult> (HttpRequest request, ISender sender, CancellationToken cancellationToken) =>
        {
            if (!TryParseSearchQuery(request.Query, out var query, out var error))
            {
                return Results.Json(new { error }, statusCode: StatusCodes.Status400BadRequest);
            }

            var response = await sender.Send(query!, cancellationToken);
            return Results.Ok(response);
        });

        group.MapGet("/{sessionId}", async Task<IResult> (string sessionId, ISender sender, CancellationToken cancellationToken) =>
        {
            try
            {
                var response = await sender.Send(new GetSessionQuery(sessionId), cancellationToken);
                return Results.Ok(response);
            }
            catch (KeyNotFoundException exception)
            {
                return Results.Json(new { error = exception.Message }, statusCode: StatusCodes.Status404NotFound);
            }
        });

        group.MapGet("/{sessionId}/children", async Task<IResult> (string sessionId, HttpRequest request, ISender sender, CancellationToken cancellationToken) =>
        {
            if (!TryParseChildrenQuery(request.Query, out var query, out var error))
            {
                return Results.Json(new { error }, statusCode: StatusCodes.Status400BadRequest);
            }

            try
            {
                var response = await sender.Send(new GetSessionChildrenQuery(sessionId, query!.Limit, query.Offset), cancellationToken);
                return Results.Ok(response);
            }
            catch (KeyNotFoundException exception)
            {
                return Results.Json(new { error = exception.Message }, statusCode: StatusCodes.Status404NotFound);
            }
        });

        group.MapGet("/{sessionId}/tasks", async Task<IResult> (string sessionId, ISender sender, CancellationToken cancellationToken) =>
        {
            try
            {
                var response = await sender.Send(new GetSessionTasksQuery(sessionId), cancellationToken);
                return Results.Ok(response);
            }
            catch (KeyNotFoundException exception)
            {
                return Results.Json(new { error = exception.Message }, statusCode: StatusCodes.Status404NotFound);
            }
        });

        group.MapPost("/{sessionId}/messages/truncate", async Task<IResult> (string sessionId, JsonElement body, ISender sender, CancellationToken cancellationToken) =>
        {
            if (!TryParseTruncateBody(body, sessionId, out var command, out var issues))
            {
                return Results.Json(new { error = "Invalid input", issues }, statusCode: StatusCodes.Status400BadRequest);
            }

            try
            {
                var response = await sender.Send(command!, cancellationToken);
                return Results.Ok(response);
            }
            catch (KeyNotFoundException exception)
            {
                return Results.Json(new { error = exception.Message }, statusCode: StatusCodes.Status404NotFound);
            }
        });

        group.MapPatch("/{sessionId}", async Task<IResult> (string sessionId, JsonElement body, ISender sender, CancellationToken cancellationToken) =>
        {
            if (!TryParsePatchBody(body, sessionId, out var command, out var issues))
            {
                return Results.Json(new { error = "Invalid input", issues }, statusCode: StatusCodes.Status400BadRequest);
            }

            try
            {
                await sender.Send(command!, cancellationToken);
                return Results.Ok(new { ok = true });
            }
            catch (SessionRequestValidationException exception)
            {
                return Results.Json(
                    exception.Issues is { Count: > 0 }
                        ? new { error = exception.Error, issues = exception.Issues }
                        : new { error = exception.Error },
                    statusCode: exception.StatusCode);
            }
            catch (KeyNotFoundException exception)
            {
                return Results.Json(new { error = exception.Message }, statusCode: StatusCodes.Status404NotFound);
            }
        });

        group.MapDelete("/{sessionId}", async Task<IResult> (string sessionId, ISender sender, CancellationToken cancellationToken) =>
        {
            try
            {
                var response = await sender.Send(new DeleteSessionCommand(sessionId), cancellationToken);
                return Results.Ok(response);
            }
            catch (SessionDeletionBlockedException exception)
            {
                return Results.Json(new
                {
                    error = exception.Message,
                    blockReason = exception.BlockReason,
                    sessionId = exception.SessionId,
                    state_status = exception.StateStatus,
                }, statusCode: StatusCodes.Status409Conflict);
            }
            catch (KeyNotFoundException exception)
            {
                return Results.Json(new { error = exception.Message }, statusCode: StatusCodes.Status404NotFound);
            }
        });

        return endpoints;
    }

    private static bool TryParseCreateBody(JsonElement body, out CreateSessionCommand? command, out List<object> issues)
    {
        command = null;
        issues = [];
        if (body.ValueKind is not (JsonValueKind.Object or JsonValueKind.Undefined or JsonValueKind.Null))
        {
            issues.Add(new { code = "invalid_type", path = Array.Empty<string>(), expected = "object", received = DescribeJsonKind(body.ValueKind), message = "Expected object" });
            return false;
        }

        JsonElement? metadata = null;
        if (body.ValueKind == JsonValueKind.Object && body.TryGetProperty("metadata", out var metadataElement))
        {
            if (metadataElement.ValueKind != JsonValueKind.Object)
            {
                issues.Add(new { code = "invalid_type", path = new[] { "metadata" }, expected = "object", received = DescribeJsonKind(metadataElement.ValueKind), message = "Expected object" });
            }
            else
            {
                metadata = metadataElement.Clone();
            }
        }

        string? workingDirectory = null;
        if (body.ValueKind == JsonValueKind.Object && body.TryGetProperty("workingDirectory", out var workingDirectoryElement))
        {
            if (workingDirectoryElement.ValueKind != JsonValueKind.String)
            {
                issues.Add(new { code = "invalid_type", path = new[] { "workingDirectory" }, expected = "string", received = DescribeJsonKind(workingDirectoryElement.ValueKind), message = "Expected string" });
            }
            else
            {
                workingDirectory = workingDirectoryElement.GetString();
            }
        }

        if (issues.Count > 0)
        {
            return false;
        }

        command = new CreateSessionCommand(metadata, workingDirectory);
        return true;
    }

    private static bool TryParsePatchBody(JsonElement body, string sessionId, out PatchSessionCommand? command, out List<object> issues)
    {
        command = null;
        issues = [];
        if (body.ValueKind != JsonValueKind.Object)
        {
            issues.Add(new { code = "invalid_type", path = Array.Empty<string>(), expected = "object", received = DescribeJsonKind(body.ValueKind), message = "Expected object" });
            return false;
        }

        string? title = null;
        if (body.TryGetProperty("title", out var titleElement))
        {
            if (titleElement.ValueKind != JsonValueKind.String)
            {
                issues.Add(new { code = "invalid_type", path = new[] { "title" }, expected = "string", received = DescribeJsonKind(titleElement.ValueKind), message = "Expected string" });
            }
            else
            {
                title = titleElement.GetString();
                if (string.IsNullOrEmpty(title))
                {
                    issues.Add(new { code = "too_small", minimum = 1, type = "string", inclusive = true, exact = false, path = new[] { "title" }, message = "String must contain at least 1 character(s)" });
                }
                else if (title.Length > 200)
                {
                    issues.Add(new { code = "too_big", maximum = 200, type = "string", inclusive = true, exact = false, path = new[] { "title" }, message = "String must contain at most 200 character(s)" });
                }
            }
        }

        JsonElement? metadata = null;
        if (body.TryGetProperty("metadata", out var metadataElement))
        {
            if (metadataElement.ValueKind != JsonValueKind.Object)
            {
                issues.Add(new { code = "invalid_type", path = new[] { "metadata" }, expected = "object", received = DescribeJsonKind(metadataElement.ValueKind), message = "Expected object" });
            }
            else
            {
                metadata = metadataElement.Clone();
            }
        }

        if (body.TryGetProperty("state_status", out var stateStatusElement)
            && stateStatusElement.ValueKind != JsonValueKind.String)
        {
            issues.Add(new { code = "invalid_type", path = new[] { "state_status" }, expected = "string", received = DescribeJsonKind(stateStatusElement.ValueKind), message = "Expected string" });
        }
        else if (body.TryGetProperty("state_status", out stateStatusElement)
            && stateStatusElement.GetString() is not ("idle" or "running" or "paused"))
        {
            issues.Add(new { code = "invalid_enum_value", path = new[] { "state_status" }, message = "Invalid enum value" });
        }

        if (issues.Count > 0)
        {
            return false;
        }

        command = new PatchSessionCommand(sessionId, title, metadata);
        return true;
    }

    private static bool TryParseListQuery(IQueryCollection queryCollection, out GetSessionsQuery? query, out string error)
    {
        query = null;
        error = string.Empty;

        var limit = 20;
        if (queryCollection.TryGetValue("limit", out var limitValue) && !int.TryParse(limitValue, out limit))
        {
            error = "Invalid query params";
            return false;
        }

        if (limit < 1 || limit > 100)
        {
            error = "Invalid query params";
            return false;
        }

        var offset = 0;
        if (queryCollection.TryGetValue("offset", out var offsetValue) && !int.TryParse(offsetValue, out offset))
        {
            error = "Invalid query params";
            return false;
        }

        if (offset < 0)
        {
            error = "Invalid query params";
            return false;
        }

        query = new GetSessionsQuery(limit, offset);
        return true;
    }

    private static bool TryParseChildrenQuery(IQueryCollection queryCollection, out GetSessionsQuery? query, out string error)
    {
        query = null;
        error = string.Empty;

        var limit = 20;
        if (queryCollection.TryGetValue("limit", out var limitValue) && !int.TryParse(limitValue, out limit))
        {
            error = "Invalid query params";
            return false;
        }

        if (limit < 1 || limit > 50)
        {
            error = "Invalid query params";
            return false;
        }

        var offset = 0;
        if (queryCollection.TryGetValue("offset", out var offsetValue) && !int.TryParse(offsetValue, out offset))
        {
            error = "Invalid query params";
            return false;
        }

        if (offset < 0)
        {
            error = "Invalid query params";
            return false;
        }

        query = new GetSessionsQuery(limit, offset);
        return true;
    }

    private static bool TryParseSearchQuery(IQueryCollection queryCollection, out SearchSessionsQuery? query, out string error)
    {
        query = null;
        error = string.Empty;

        var rawQuery = queryCollection.TryGetValue("q", out var queryValue)
            ? queryValue.ToString().Trim()
            : string.Empty;
        if (string.IsNullOrWhiteSpace(rawQuery))
        {
            error = "Invalid query params";
            return false;
        }

        var limit = 8;
        if (queryCollection.TryGetValue("limit", out var limitValue) && !int.TryParse(limitValue, out limit))
        {
            error = "Invalid query params";
            return false;
        }

        if (limit < 1 || limit > 20)
        {
            error = "Invalid query params";
            return false;
        }

        query = new SearchSessionsQuery(rawQuery, limit);
        return true;
    }

    private static bool TryParseTruncateBody(JsonElement body, string sessionId, out TruncateSessionMessagesCommand? command, out List<object> issues)
    {
        command = null;
        issues = [];
        if (body.ValueKind != JsonValueKind.Object)
        {
            issues.Add(new { code = "invalid_type", path = Array.Empty<string>(), expected = "object", received = DescribeJsonKind(body.ValueKind), message = "Expected object" });
            return false;
        }

        string? messageId = null;
        if (!body.TryGetProperty("messageId", out var messageIdElement) || messageIdElement.ValueKind != JsonValueKind.String)
        {
            issues.Add(new { code = "invalid_type", path = new[] { "messageId" }, expected = "string", received = body.TryGetProperty("messageId", out var actual) ? DescribeJsonKind(actual.ValueKind) : "undefined", message = "Expected string" });
        }
        else
        {
            messageId = messageIdElement.GetString();
            if (string.IsNullOrWhiteSpace(messageId))
            {
                issues.Add(new { code = "too_small", minimum = 1, type = "string", inclusive = true, exact = false, path = new[] { "messageId" }, message = "String must contain at least 1 character(s)" });
            }
        }

        var inclusive = true;
        if (body.TryGetProperty("inclusive", out var inclusiveElement))
        {
            if (inclusiveElement.ValueKind != JsonValueKind.True && inclusiveElement.ValueKind != JsonValueKind.False)
            {
                issues.Add(new { code = "invalid_type", path = new[] { "inclusive" }, expected = "boolean", received = DescribeJsonKind(inclusiveElement.ValueKind), message = "Expected boolean" });
            }
            else
            {
                inclusive = inclusiveElement.GetBoolean();
            }
        }

        string? messageText = null;
        if (body.TryGetProperty("messageText", out var messageTextElement))
        {
            if (messageTextElement.ValueKind != JsonValueKind.String)
            {
                issues.Add(new { code = "invalid_type", path = new[] { "messageText" }, expected = "string", received = DescribeJsonKind(messageTextElement.ValueKind), message = "Expected string" });
            }
            else
            {
                messageText = messageTextElement.GetString();
            }
        }

        if (issues.Count > 0)
        {
            return false;
        }

        command = new TruncateSessionMessagesCommand(sessionId, messageId!, inclusive, messageText);
        return true;
    }

    private static string DescribeJsonKind(JsonValueKind valueKind)
        => valueKind switch
        {
            JsonValueKind.Object => "object",
            JsonValueKind.Array => "array",
            JsonValueKind.String => "string",
            JsonValueKind.Number => "number",
            JsonValueKind.True or JsonValueKind.False => "boolean",
            JsonValueKind.Null => "null",
            _ => "undefined",
        };
}
