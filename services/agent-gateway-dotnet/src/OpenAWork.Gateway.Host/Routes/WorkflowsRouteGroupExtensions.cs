using System.Text.Json;
using Microsoft.Extensions.Configuration;
using MediatR;
using OpenAWork.Gateway.Application.Features.Workflows;

namespace OpenAWork.Gateway.Host.Routes;

public static class WorkflowsRouteGroupExtensions
{
    public static IEndpointRouteBuilder MapWorkflowsRoutes(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/workflows").RequireAuthorization();

        group.MapGet("/templates", async (ISender sender, CancellationToken cancellationToken) =>
        {
            var response = await sender.Send(new GetWorkflowTemplatesQuery(), cancellationToken);
            return TypedResults.Ok(response);
        });

        group.MapPost("/templates", async Task<IResult> (JsonElement body, ISender sender, CancellationToken cancellationToken) =>
        {
            if (!TryParseCreateTemplateBody(body, out var command, out var issues))
            {
                return Results.Json(new { error = "Invalid input", issues }, statusCode: StatusCodes.Status400BadRequest);
            }

            var response = await sender.Send(command!, cancellationToken);
            return Results.Json(response, statusCode: StatusCodes.Status201Created);
        });

        group.MapDelete("/templates/{id}", async Task<IResult> (string id, ISender sender, CancellationToken cancellationToken) =>
        {
            if (string.IsNullOrWhiteSpace(id))
            {
                return Results.Json(new
                {
                    error = "Invalid input",
                    issues = new[] { new { code = "too_small", minimum = 1, type = "string", inclusive = true, exact = false, path = new[] { "id" }, message = "String must contain at least 1 character(s)" } },
                }, statusCode: StatusCodes.Status400BadRequest);
            }

            try
            {
                await sender.Send(new DeleteWorkflowTemplateCommand(id.Trim()), cancellationToken);
                return Results.NoContent();
            }
            catch (KeyNotFoundException exception)
            {
                return Results.Json(new { error = exception.Message }, statusCode: StatusCodes.Status404NotFound);
            }
        });

        group.MapPost("/optimize-prompt", async Task<IResult> (JsonElement body, ISender sender, IConfiguration configuration, CancellationToken cancellationToken) =>
        {
            if (!TryParseOptimizePromptBody(body, configuration, out var command, out var issues))
            {
                return Results.Json(new { error = "Invalid input", issues }, statusCode: StatusCodes.Status400BadRequest);
            }

            var response = await sender.Send(command!, cancellationToken);
            return Results.Ok(response);
        });

        group.MapPost("/translate", async Task<IResult> (JsonElement body, ISender sender, IConfiguration configuration, CancellationToken cancellationToken) =>
        {
            if (!TryParseTranslateBody(body, configuration, out var command, out var issues))
            {
                return Results.Json(new { error = "Invalid input", issues }, statusCode: StatusCodes.Status400BadRequest);
            }

            var response = await sender.Send(command!, cancellationToken);
            return Results.Ok(response);
        });

        return endpoints;
    }

    private static bool TryParseCreateTemplateBody(
        JsonElement body,
        out CreateWorkflowTemplateCommand? command,
        out List<object> issues)
    {
        command = null;
        issues = [];

        if (body.ValueKind != JsonValueKind.Object)
        {
            issues.Add(CreateInvalidTypeIssue(Array.Empty<string>(), "object", DescribeJsonKind(body.ValueKind)));
            return false;
        }

        var name = ReadRequiredString(body, "name", issues);
        var description = ReadOptionalString(body, "description", issues);
        var category = ReadOptionalString(body, "category", issues) ?? "general";
        var metadata = ReadOptionalObject(body, "metadata", issues) ?? JsonSerializer.SerializeToElement(new Dictionary<string, object?>());
        var nodes = ReadOptionalArrayOfObjects(body, "nodes", issues) ?? JsonSerializer.SerializeToElement(Array.Empty<object>());
        var edges = ReadOptionalArrayOfObjects(body, "edges", issues) ?? JsonSerializer.SerializeToElement(Array.Empty<object>());

        ValidateWorkflowMetadata(category, metadata, issues);

        if (issues.Count > 0 || name is null)
        {
            return false;
        }

        command = new CreateWorkflowTemplateCommand(name, description, category, metadata, nodes, edges);
        return true;
    }

    private static string? ReadRequiredString(JsonElement body, string propertyName, List<object> issues)
    {
        if (!body.TryGetProperty(propertyName, out var element))
        {
            issues.Add(CreateInvalidTypeIssue(new[] { propertyName }, "string", "undefined"));
            return null;
        }

        if (element.ValueKind != JsonValueKind.String)
        {
            issues.Add(CreateInvalidTypeIssue(new[] { propertyName }, "string", DescribeJsonKind(element.ValueKind)));
            return null;
        }

        var value = element.GetString() ?? string.Empty;
        if (value.Length < 1)
        {
            issues.Add(new { code = "too_small", minimum = 1, type = "string", inclusive = true, exact = false, path = new[] { propertyName }, message = "String must contain at least 1 character(s)" });
            return null;
        }

        return value;
    }

    private static string? ReadOptionalString(JsonElement body, string propertyName, List<object> issues)
        => ReadOptionalString(body, propertyName, issues, null);

    private static string? ReadOptionalString(JsonElement body, string propertyName, List<object> issues, string[]? pathPrefix)
    {
        if (!body.TryGetProperty(propertyName, out var element))
        {
            return null;
        }

        if (element.ValueKind != JsonValueKind.String)
        {
            issues.Add(CreateInvalidTypeIssue(BuildPath(pathPrefix, propertyName), "string", DescribeJsonKind(element.ValueKind)));
            return null;
        }

        return element.GetString();
    }

    private static JsonElement? ReadOptionalObject(JsonElement body, string propertyName, List<object> issues)
    {
        if (!body.TryGetProperty(propertyName, out var element))
        {
            return null;
        }

        if (element.ValueKind != JsonValueKind.Object)
        {
            issues.Add(CreateInvalidTypeIssue(new[] { propertyName }, "object", DescribeJsonKind(element.ValueKind)));
            return null;
        }

        return element.Clone();
    }

    private static JsonElement? ReadOptionalArrayOfObjects(JsonElement body, string propertyName, List<object> issues)
    {
        if (!body.TryGetProperty(propertyName, out var element))
        {
            return null;
        }

        if (element.ValueKind != JsonValueKind.Array)
        {
            issues.Add(CreateInvalidTypeIssue(new[] { propertyName }, "array", DescribeJsonKind(element.ValueKind)));
            return null;
        }

        var index = 0;
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                issues.Add(CreateInvalidTypeIssue(new[] { propertyName, index.ToString() }, "object", DescribeJsonKind(item.ValueKind)));
            }

            index += 1;
        }

        return issues.Count == 0 ? element.Clone() : null;
    }

    private static object CreateInvalidTypeIssue(string[] path, string expected, string received)
        => new { code = "invalid_type", path, expected, received, message = $"Expected {expected}" };

    private static bool TryParseOptimizePromptBody(
        JsonElement body,
        IConfiguration configuration,
        out OptimizePromptCommand? command,
        out List<object> issues)
    {
        command = null;
        issues = [];

        if (body.ValueKind != JsonValueKind.Object)
        {
            issues.Add(CreateInvalidTypeIssue(Array.Empty<string>(), "object", DescribeJsonKind(body.ValueKind)));
            return false;
        }

        var originalPrompt = ReadRequiredString(body, "originalPrompt", issues);
        var context = ReadOptionalString(body, "context", issues);
        var targetAudience = ReadOptionalString(body, "targetAudience", issues);
        var candidateCount = 3;

        if (body.TryGetProperty("candidateCount", out var candidateCountElement))
        {
            if (candidateCountElement.ValueKind != JsonValueKind.Number || !candidateCountElement.TryGetInt32(out candidateCount) || candidateCount < 1 || candidateCount > 5)
            {
                issues.Add(new { code = "too_big", path = new[] { "candidateCount" }, message = "Number must be between 1 and 5" });
            }
        }

        if (issues.Count > 0 || originalPrompt is null)
        {
            return false;
        }

        command = new OptimizePromptCommand(
            originalPrompt,
            context,
            targetAudience,
            candidateCount,
            configuration["AI_API_BASE_URL"] ?? "https://api.openai.com/v1",
            configuration["AI_API_KEY"] ?? string.Empty,
            configuration["AI_DEFAULT_MODEL"] ?? "gpt-4o");
        return true;
    }

    private static void ValidateWorkflowMetadata(string category, JsonElement metadata, List<object> issues)
    {
        if (!string.Equals(category, "team-playbook", StringComparison.Ordinal))
        {
            return;
        }

        if (!metadata.TryGetProperty("teamTemplate", out var teamTemplateElement))
        {
            return;
        }

        if (teamTemplateElement.ValueKind != JsonValueKind.Object)
        {
            issues.Add(CreateInvalidTypeIssue(new[] { "metadata", "teamTemplate" }, "object", DescribeJsonKind(teamTemplateElement.ValueKind)));
            return;
        }

        if (teamTemplateElement.TryGetProperty("defaultBindings", out var defaultBindingsElement))
        {
            ValidateDefaultBindings(defaultBindingsElement, issues);
        }

        if (teamTemplateElement.TryGetProperty("defaultProvider", out var defaultProviderElement)
            && defaultProviderElement.ValueKind is not (JsonValueKind.String or JsonValueKind.Null))
        {
            issues.Add(CreateInvalidTypeIssue(new[] { "metadata", "teamTemplate", "defaultProvider" }, "string", DescribeJsonKind(defaultProviderElement.ValueKind)));
        }

        if (teamTemplateElement.TryGetProperty("optionalAgentIds", out var optionalAgentIdsElement))
        {
            ValidateStringArray(optionalAgentIdsElement, new[] { "metadata", "teamTemplate", "optionalAgentIds" }, issues);
        }

        if (teamTemplateElement.TryGetProperty("requiredRoles", out var requiredRolesElement))
        {
            ValidateRequiredRoles(requiredRolesElement, issues);
        }
    }

    private static void ValidateDefaultBindings(JsonElement defaultBindingsElement, List<object> issues)
    {
        if (defaultBindingsElement.ValueKind != JsonValueKind.Object)
        {
            issues.Add(CreateInvalidTypeIssue(new[] { "metadata", "teamTemplate", "defaultBindings" }, "object", DescribeJsonKind(defaultBindingsElement.ValueKind)));
            return;
        }

        foreach (var roleProperty in defaultBindingsElement.EnumerateObject())
        {
            if (roleProperty.Name is not ("leader" or "planner" or "researcher" or "executor" or "reviewer"))
            {
                continue;
            }

            if (roleProperty.Value.ValueKind == JsonValueKind.String)
            {
                if (string.IsNullOrWhiteSpace(roleProperty.Value.GetString()))
                {
                    issues.Add(new { code = "too_small", minimum = 1, type = "string", inclusive = true, exact = false, path = new[] { "metadata", "teamTemplate", "defaultBindings", roleProperty.Name }, message = "String must contain at least 1 character(s)" });
                }

                continue;
            }

            if (roleProperty.Value.ValueKind != JsonValueKind.Object)
            {
                issues.Add(CreateInvalidTypeIssue(new[] { "metadata", "teamTemplate", "defaultBindings", roleProperty.Name }, "object", DescribeJsonKind(roleProperty.Value.ValueKind)));
                continue;
            }

            var agentId = ReadRequiredString(roleProperty.Value, "agentId", issues, ["metadata", "teamTemplate", "defaultBindings", roleProperty.Name]);
            _ = agentId;
            ValidateOptionalMinString(roleProperty.Value, "modelId", ["metadata", "teamTemplate", "defaultBindings", roleProperty.Name], issues);
            ValidateOptionalMinString(roleProperty.Value, "providerId", ["metadata", "teamTemplate", "defaultBindings", roleProperty.Name], issues);
            ValidateOptionalBoundedString(roleProperty.Value, "variant", 1, 80, ["metadata", "teamTemplate", "defaultBindings", roleProperty.Name], issues);
        }
    }

    private static void ValidateRequiredRoles(JsonElement requiredRolesElement, List<object> issues)
    {
        if (requiredRolesElement.ValueKind != JsonValueKind.Array)
        {
            issues.Add(CreateInvalidTypeIssue(new[] { "metadata", "teamTemplate", "requiredRoles" }, "array", DescribeJsonKind(requiredRolesElement.ValueKind)));
            return;
        }

        var index = 0;
        foreach (var roleElement in requiredRolesElement.EnumerateArray())
        {
            if (roleElement.ValueKind != JsonValueKind.String)
            {
                issues.Add(CreateInvalidTypeIssue(new[] { "metadata", "teamTemplate", "requiredRoles", index.ToString() }, "string", DescribeJsonKind(roleElement.ValueKind)));
            }
            else if (roleElement.GetString() is not ("leader" or "planner" or "researcher" or "executor" or "reviewer"))
            {
                issues.Add(new { code = "invalid_enum_value", path = new[] { "metadata", "teamTemplate", "requiredRoles", index.ToString() }, message = "Invalid required role" });
            }

            index += 1;
        }
    }

    private static void ValidateStringArray(JsonElement arrayElement, string[] path, List<object> issues)
    {
        if (arrayElement.ValueKind != JsonValueKind.Array)
        {
            issues.Add(CreateInvalidTypeIssue(path, "array", DescribeJsonKind(arrayElement.ValueKind)));
            return;
        }

        var index = 0;
        foreach (var item in arrayElement.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.String)
            {
                issues.Add(CreateInvalidTypeIssue([.. path, index.ToString()], "string", DescribeJsonKind(item.ValueKind)));
            }
            else if (string.IsNullOrWhiteSpace(item.GetString()))
            {
                issues.Add(new { code = "too_small", minimum = 1, type = "string", inclusive = true, exact = false, path = [.. path, index.ToString()], message = "String must contain at least 1 character(s)" });
            }

            index += 1;
        }
    }

    private static void ValidateOptionalMinString(JsonElement body, string propertyName, string[] pathPrefix, List<object> issues)
    {
        if (!body.TryGetProperty(propertyName, out var element))
        {
            return;
        }

        if (element.ValueKind != JsonValueKind.String)
        {
            issues.Add(CreateInvalidTypeIssue(BuildPath(pathPrefix, propertyName), "string", DescribeJsonKind(element.ValueKind)));
            return;
        }

        if (string.IsNullOrWhiteSpace(element.GetString()))
        {
            issues.Add(new { code = "too_small", minimum = 1, type = "string", inclusive = true, exact = false, path = BuildPath(pathPrefix, propertyName), message = "String must contain at least 1 character(s)" });
        }
    }

    private static void ValidateOptionalBoundedString(JsonElement body, string propertyName, int minLength, int maxLength, string[] pathPrefix, List<object> issues)
    {
        if (!body.TryGetProperty(propertyName, out var element))
        {
            return;
        }

        if (element.ValueKind != JsonValueKind.String)
        {
            issues.Add(CreateInvalidTypeIssue(BuildPath(pathPrefix, propertyName), "string", DescribeJsonKind(element.ValueKind)));
            return;
        }

        var value = element.GetString() ?? string.Empty;
        if (value.Length < minLength)
        {
            issues.Add(new { code = "too_small", minimum = minLength, type = "string", inclusive = true, exact = false, path = BuildPath(pathPrefix, propertyName), message = $"String must contain at least {minLength} character(s)" });
            return;
        }

        if (value.Length > maxLength)
        {
            issues.Add(new { code = "too_big", maximum = maxLength, type = "string", inclusive = true, exact = false, path = BuildPath(pathPrefix, propertyName), message = $"String must contain at most {maxLength} character(s)" });
        }
    }

    private static bool TryParseTranslateBody(
        JsonElement body,
        IConfiguration configuration,
        out TranslateWorkflowCommand? command,
        out List<object> issues)
    {
        command = null;
        issues = [];

        if (body.ValueKind != JsonValueKind.Object)
        {
            issues.Add(CreateInvalidTypeIssue(Array.Empty<string>(), "object", DescribeJsonKind(body.ValueKind)));
            return false;
        }

        if (!body.TryGetProperty("tasks", out var tasksElement))
        {
            issues.Add(CreateInvalidTypeIssue(new[] { "tasks" }, "array", "undefined"));
            return false;
        }

        if (tasksElement.ValueKind != JsonValueKind.Array)
        {
            issues.Add(CreateInvalidTypeIssue(new[] { "tasks" }, "array", DescribeJsonKind(tasksElement.ValueKind)));
            return false;
        }

        if (tasksElement.GetArrayLength() < 1)
        {
            issues.Add(new { code = "too_small", path = new[] { "tasks" }, message = "Array must contain at least 1 item(s)" });
            return false;
        }

        var tasks = new List<TranslateWorkflowTaskCommand>();
        var index = 0;
        foreach (var taskElement in tasksElement.EnumerateArray())
        {
            if (taskElement.ValueKind != JsonValueKind.Object)
            {
                issues.Add(CreateInvalidTypeIssue(new[] { "tasks", index.ToString() }, "object", DescribeJsonKind(taskElement.ValueKind)));
                index += 1;
                continue;
            }

            var id = ReadRequiredString(taskElement, "id", issues, ["tasks", index.ToString()]);
            var content = ReadRequiredString(taskElement, "content", issues, ["tasks", index.ToString()]);
            var fileName = ReadRequiredString(taskElement, "fileName", issues, ["tasks", index.ToString()]);
            var sourceLanguage = ReadOptionalString(taskElement, "sourceLanguage", issues, ["tasks", index.ToString()]) ?? "auto";
            var targetLanguage = ReadRequiredString(taskElement, "targetLanguage", issues, ["tasks", index.ToString()]);

            if (id is not null && content is not null && fileName is not null && targetLanguage is not null)
            {
                tasks.Add(new TranslateWorkflowTaskCommand(id, content, fileName, sourceLanguage, targetLanguage));
            }

            index += 1;
        }

        if (issues.Count > 0)
        {
            return false;
        }

        command = new TranslateWorkflowCommand(
            tasks,
            configuration["AI_API_BASE_URL"] ?? "https://api.openai.com/v1",
            configuration["AI_API_KEY"] ?? string.Empty,
            configuration["AI_DEFAULT_MODEL"] ?? "gpt-4o");
        return true;
    }

    private static string? ReadRequiredString(JsonElement body, string propertyName, List<object> issues, string[]? pathPrefix = null)
    {
        if (!body.TryGetProperty(propertyName, out var element))
        {
            issues.Add(CreateInvalidTypeIssue(BuildPath(pathPrefix, propertyName), "string", "undefined"));
            return null;
        }

        if (element.ValueKind != JsonValueKind.String)
        {
            issues.Add(CreateInvalidTypeIssue(BuildPath(pathPrefix, propertyName), "string", DescribeJsonKind(element.ValueKind)));
            return null;
        }

        var value = element.GetString() ?? string.Empty;
        if (value.Length < 1)
        {
            issues.Add(new { code = "too_small", minimum = 1, type = "string", inclusive = true, exact = false, path = BuildPath(pathPrefix, propertyName), message = "String must contain at least 1 character(s)" });
            return null;
        }

        return value;
    }

    private static string[] BuildPath(string[]? prefix, string segment)
        => prefix is null ? [segment] : [.. prefix, segment];

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
