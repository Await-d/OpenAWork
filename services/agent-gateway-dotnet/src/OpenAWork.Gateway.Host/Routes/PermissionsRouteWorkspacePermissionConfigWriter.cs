using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using OpenAWork.Gateway.Persistence.EFCore;

namespace OpenAWork.Gateway.Host.Routes;

internal static class PermissionsRouteWorkspacePermissionConfigWriter
{
    private const string WorkspacePermissionFile = ".openawork.permissions.json";
    private static readonly ConcurrentDictionary<string, SemaphoreSlim> WorkspacePermissionFileLocks = new(StringComparer.Ordinal);

    internal static async Task<WorkspacePermissionMaterializationResult?> PersistAsync(
        GatewayDbContext dbContext,
        IConfiguration configuration,
        string sessionId,
        string toolName,
        IReadOnlyList<string> patterns,
        CancellationToken cancellationToken)
    {
        var workspaceRoot = await ResolveSessionWorkspaceRootAsync(dbContext, configuration, sessionId, cancellationToken);
        if (workspaceRoot is null)
        {
            return null;
        }

        var filePath = Path.Combine(workspaceRoot, WorkspacePermissionFile);
        var fileLock = WorkspacePermissionFileLocks.GetOrAdd(workspaceRoot, static _ => new SemaphoreSlim(1, 1));
        await fileLock.WaitAsync(cancellationToken);
        try
        {
            EnsureWorkspacePermissionTargetIsSafe(filePath);

            var fileExisted = File.Exists(filePath);
            var originalContent = fileExisted
                ? await File.ReadAllTextAsync(filePath, cancellationToken)
                : null;
            var config = await LoadWorkspacePermissionConfigAsync(filePath, cancellationToken);
            var grantedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var category = ResolvePermissionCategory(toolName);
            var permanentGrants = config["permanentGrants"] as JsonArray ?? new JsonArray();
            var rules = config["rules"] as JsonArray ?? new JsonArray();

            foreach (var pattern in patterns)
            {
                if (!permanentGrants.Any((item) =>
                    item is JsonObject grant
                    && string.Equals(ReadJsonString(grant, "toolName"), category, StringComparison.Ordinal)
                    && string.Equals(ReadJsonString(grant, "scope"), pattern, StringComparison.Ordinal)
                    && string.Equals(ReadJsonString(grant, "decision"), "permanent", StringComparison.Ordinal)))
                {
                    permanentGrants.Add(new JsonObject
                    {
                        ["id"] = $"{category}:{pattern}:{grantedAt}",
                        ["toolName"] = category,
                        ["scope"] = pattern,
                        ["grantedAt"] = grantedAt,
                        ["decision"] = "permanent",
                    });
                }

                if (!rules.Any((item) =>
                    item is JsonObject rule
                    && string.Equals(ReadJsonString(rule, "permission"), category, StringComparison.Ordinal)
                    && string.Equals(ReadJsonString(rule, "pattern"), pattern, StringComparison.Ordinal)
                    && string.Equals(ReadJsonString(rule, "action"), "allow", StringComparison.Ordinal)))
                {
                    rules.Add(new JsonObject
                    {
                        ["permission"] = category,
                        ["pattern"] = pattern,
                        ["action"] = "allow",
                    });
                }
            }

            config["permanentGrants"] = permanentGrants;
            config["rules"] = rules;
            await WriteWorkspacePermissionConfigAsync(filePath, config, cancellationToken);
            return new WorkspacePermissionMaterializationResult(workspaceRoot, filePath, fileExisted, originalContent);
        }
        finally
        {
            fileLock.Release();
        }
    }

    internal static async Task RollbackAsync(
        WorkspacePermissionMaterializationResult materialization,
        CancellationToken cancellationToken)
    {
        var fileLock = WorkspacePermissionFileLocks.GetOrAdd(
            materialization.WorkspaceRoot,
            static _ => new SemaphoreSlim(1, 1));
        await fileLock.WaitAsync(cancellationToken);
        try
        {
            EnsureWorkspacePermissionTargetIsSafe(materialization.FilePath);

            if (materialization.HadExistingFile)
            {
                await WriteWorkspacePermissionConfigTextAsync(
                    materialization.FilePath,
                    materialization.OriginalContent ?? string.Empty,
                    cancellationToken);
                return;
            }

            if (File.Exists(materialization.FilePath))
            {
                File.Delete(materialization.FilePath);
            }
        }
        finally
        {
            fileLock.Release();
        }
    }

    private static async Task<JsonObject> LoadWorkspacePermissionConfigAsync(string filePath, CancellationToken cancellationToken)
    {
        if (!File.Exists(filePath))
        {
            return new JsonObject();
        }

        try
        {
            return JsonNode.Parse(await File.ReadAllTextAsync(filePath, cancellationToken)) as JsonObject ?? new JsonObject();
        }
        catch (JsonException)
        {
            return new JsonObject();
        }
    }

    private static Task WriteWorkspacePermissionConfigAsync(string filePath, JsonObject config, CancellationToken cancellationToken)
        => WriteWorkspacePermissionConfigTextAsync(
            filePath,
            config.ToJsonString(new JsonSerializerOptions { WriteIndented = true }),
            cancellationToken);

    private static async Task WriteWorkspacePermissionConfigTextAsync(
        string filePath,
        string content,
        CancellationToken cancellationToken)
    {
        var directory = Path.GetDirectoryName(filePath) ?? throw new InvalidOperationException("Permission config path has no directory.");
        Directory.CreateDirectory(directory);
        var tempFilePath = Path.Combine(directory, $"{Path.GetFileName(filePath)}.{Guid.NewGuid():N}.tmp");
        try
        {
            await File.WriteAllTextAsync(tempFilePath, content, cancellationToken);
            if (File.Exists(filePath))
            {
                File.Move(tempFilePath, filePath, overwrite: true);
            }
            else
            {
                File.Move(tempFilePath, filePath);
            }
        }
        finally
        {
            if (File.Exists(tempFilePath))
            {
                File.Delete(tempFilePath);
            }
        }
    }

    private static void EnsureWorkspacePermissionTargetIsSafe(string filePath)
    {
        var fileInfo = new FileInfo(filePath);
        if ((fileInfo.Exists || fileInfo.LinkTarget is not null) && HasFileLinkTarget(fileInfo))
        {
            throw new InvalidOperationException("Workspace permission config path must not be a symbolic link.");
        }
    }

    private static bool HasFileLinkTarget(FileInfo fileInfo)
        => !string.IsNullOrWhiteSpace(fileInfo.LinkTarget)
           || (fileInfo.Exists && fileInfo.Attributes.HasFlag(FileAttributes.ReparsePoint));

    internal static async Task<string?> ResolveSessionWorkspaceRootAsync(
        GatewayDbContext dbContext,
        IConfiguration configuration,
        string sessionId,
        CancellationToken cancellationToken)
    {
        var configuredRoots = ResolveConfiguredWorkspaceRoots(configuration);
        if (configuredRoots.Count == 0)
        {
            return null;
        }

        var metadataJson = await dbContext.Sessions
            .AsNoTracking()
            .Where((session) => session.Id == sessionId)
            .Select((session) => session.MetadataJson)
            .SingleOrDefaultAsync(cancellationToken);
        var workingDirectory = ExtractWorkingDirectory(metadataJson);
        if (string.IsNullOrWhiteSpace(workingDirectory))
        {
            return configuredRoots[0];
        }

        var normalizedWorkingDirectory = Path.GetFullPath(workingDirectory);
        return configuredRoots
            .OrderByDescending((root) => root.Length)
            .FirstOrDefault((root) =>
                PermissionsRouteGroupExtensions.IsPathUnderRoot(normalizedWorkingDirectory, root)
                && !PermissionsRouteGroupExtensions.HasSymbolicLinkInDirectoryPath(normalizedWorkingDirectory, root));
    }

    internal static IReadOnlyList<string> ResolveConfiguredWorkspaceRoots(IConfiguration configuration)
    {
        var rawRoots = configuration["WORKSPACE_ROOTS"]?.Trim();
        var roots = new List<string>();
        if (!string.IsNullOrWhiteSpace(rawRoots))
        {
            if (rawRoots.StartsWith("[", StringComparison.Ordinal))
            {
                string[]? parsed = null;
                try
                {
                    parsed = JsonSerializer.Deserialize<string[]>(rawRoots);
                }
                catch (JsonException)
                {
                    parsed = null;
                }

                if (parsed is not null)
                {
                    roots.AddRange(parsed.Where((entry) => !string.IsNullOrWhiteSpace(entry)));
                }
            }
            else
            {
                roots.AddRange(rawRoots
                    .Split(new[] { Path.PathSeparator, '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
            }
        }

        var configuredRoot = configuration["WORKSPACE_ROOT"]?.Trim();
        if (!string.IsNullOrWhiteSpace(configuredRoot))
        {
            roots.Add(configuredRoot);
        }

        return roots
            .Where((root) => !string.IsNullOrWhiteSpace(root) && Path.IsPathRooted(root))
            .Select(Path.GetFullPath)
            .Where((root) => Directory.Exists(root) && !PermissionsRouteGroupExtensions.HasSymbolicLinkInDirectoryPath(root, root))
            .Distinct(StringComparer.Ordinal)
            .ToList();
    }

    private static string ResolvePermissionCategory(string toolName)
        => toolName switch
        {
            "read" or "workspace_read_file" => "read",
            "edit" or "apply_patch" => "edit",
            "write" or "workspace_write_file" or "workspace_create_file" or "workspace_create_directory" => "write",
            "bash" or "interactive_bash" => "bash",
            "glob" => "glob",
            "grep" => "grep",
            "task" => "task",
            "skill" or "skill_mcp" => "skill",
            "mcp_call" => "mcp_call",
            "lsp_rename" => "lsp",
            "websearch" => "websearch",
            "webfetch" => "webfetch",
            "codesearch" => "codesearch",
            "workspace_review_revert" => "edit",
            "desktop_automation" => "desktop_automation",
            _ => toolName,
        };

    private static string? ReadJsonString(JsonObject obj, string key)
        => obj[key] is JsonValue value && value.TryGetValue<string>(out var str) ? str : null;

    private static string? ExtractWorkingDirectory(string? metadataJson)
    {
        if (string.IsNullOrWhiteSpace(metadataJson))
        {
            return null;
        }

        try
        {
            var metadata = JsonNode.Parse(metadataJson) as JsonObject;
            return metadata?["workingDirectory"] is JsonValue value && value.TryGetValue<string>(out var path)
                ? path
                : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }
}

internal sealed record WorkspacePermissionMaterializationResult(
    string WorkspaceRoot,
    string FilePath,
    bool HadExistingFile,
    string? OriginalContent);
