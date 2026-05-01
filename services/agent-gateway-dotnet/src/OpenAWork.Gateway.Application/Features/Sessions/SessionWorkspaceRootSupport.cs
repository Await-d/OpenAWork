using System.Text.Json;
using Microsoft.Extensions.Configuration;

namespace OpenAWork.Gateway.Application.Features.Sessions;

internal static class SessionWorkspaceRootSupport
{
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
            .Where(Directory.Exists)
            .Distinct(StringComparer.Ordinal)
            .OrderByDescending((root) => root.Length)
            .ToArray();
    }

    internal static string? NormalizeWorkspacePath(string path, IReadOnlyList<string> workspaceRoots)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(path) || !Path.IsPathRooted(path) || workspaceRoots.Count == 0)
            {
                return null;
            }

            var candidatePath = Path.GetFullPath(path);
            return workspaceRoots.Any((root) => IsPathUnderRoot(candidatePath, root))
                ? candidatePath
                : null;
        }
        catch (Exception)
        {
            return null;
        }
    }

    private static bool IsPathUnderRoot(string candidatePath, string rootPath)
    {
        var comparison = OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
        if (string.Equals(candidatePath, rootPath, comparison))
        {
            return true;
        }

        var normalizedRoot = rootPath.EndsWith(Path.DirectorySeparatorChar)
            ? rootPath
            : rootPath + Path.DirectorySeparatorChar;
        return candidatePath.StartsWith(normalizedRoot, comparison);
    }
}
