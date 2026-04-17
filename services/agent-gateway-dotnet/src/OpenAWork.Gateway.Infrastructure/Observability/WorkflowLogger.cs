using System.Text;
using OpenAWork.Gateway.Contracts.Observability;

namespace OpenAWork.Gateway.Infrastructure.Observability;

public sealed class WorkflowLogger
{
    private readonly List<WorkflowStep> _steps = [];

    public void Reset() => _steps.Clear();

    public void TrackRoot(WorkflowStep step) => _steps.Add(step);

    public WorkflowStep Start(string name, string? message = null, IReadOnlyDictionary<string, string>? fields = null)
    {
        var step = CreateStep(name, message, fields);
        _steps.Add(step);
        return step;
    }

    public WorkflowStep StartChild(WorkflowStep parent, string name, string? message = null, IReadOnlyDictionary<string, string>? fields = null)
    {
        var child = CreateStep(name, message, fields);
        parent.Children.Add(child);
        return child;
    }

    public void Succeed(WorkflowStep step, string? message = null, IReadOnlyDictionary<string, string>? fields = null) => Complete(step, StepStatus.Success, message, fields);

    public void Fail(WorkflowStep step, string? message = null, IReadOnlyDictionary<string, string>? fields = null) => Complete(step, StepStatus.Error, message, fields);

    public void SettlePending(WorkflowStep step, StepStatus finalStatus, string? message = null, IReadOnlyDictionary<string, string>? fields = null)
    {
        foreach (var child in step.Children)
        {
            SettlePending(child, finalStatus, message, fields);
        }

        if (step.Status != StepStatus.Pending)
        {
            return;
        }

        if (finalStatus == StepStatus.Error)
        {
            Fail(step, message, fields);
            return;
        }

        Succeed(step, message, fields);
    }

    public IReadOnlyCollection<WorkflowStep> Snapshot() => _steps.Select(CloneStep).ToArray();

    public string Render(RequestContext context, int statusCode, IReadOnlyDictionary<string, string>? extra = null)
    {
        var totalMs = (long)(DateTimeOffset.UtcNow - context.StartTimeUtc).TotalMilliseconds;
        var lines = new List<string>
        {
            $"[{context.StartTimeUtc:HH:mm:ss} INF] {StatusEmoji(statusCode)} {statusCode} {context.Method} {context.Path} {totalMs}ms -",
            $"├── requestId: {context.RequestId}",
        };

        if (_steps.Count > 0)
        {
            lines.Add("├── workflow:");
            for (var index = 0; index < _steps.Count; index++)
            {
                lines.AddRange(RenderStep(_steps[index], "│   ", index == _steps.Count - 1));
            }
        }

        if (extra is not null)
        {
            var keys = extra.Keys.ToArray();
            for (var index = 0; index < keys.Length; index++)
            {
                var key = keys[index];
                var isLast = index == keys.Length - 1 && context.Ip is null && context.UserAgent is null;
                lines.Add($"{(isLast ? '└' : '├')}── {key}: {extra[key]}");
            }
        }

        if (!string.IsNullOrWhiteSpace(context.Ip))
        {
            lines.Add($"{(string.IsNullOrWhiteSpace(context.UserAgent) ? '└' : '├')}── ip: {context.Ip}");
        }

        if (!string.IsNullOrWhiteSpace(context.UserAgent))
        {
            lines.Add($"└── ua: {context.UserAgent}");
        }

        return string.Join(Environment.NewLine, lines);
    }

    private static WorkflowStep CreateStep(string name, string? message, IReadOnlyDictionary<string, string>? fields)
    {
        return new WorkflowStep
        {
            Name = name,
            Status = StepStatus.Pending,
            Message = message,
            Fields = fields?.ToDictionary(),
            StartedAtUtc = DateTimeOffset.UtcNow,
        };
    }

    private static void Complete(WorkflowStep step, StepStatus status, string? message, IReadOnlyDictionary<string, string>? fields)
    {
        step.Status = status;
        if (message is not null)
        {
            step.Message = message;
        }

        if (fields is not null)
        {
            step.Fields ??= [];
            foreach (var (key, value) in fields)
            {
                step.Fields[key] = value;
            }
        }

        if (step.StartedAtUtc is not null)
        {
            step.DurationMs = (long)(DateTimeOffset.UtcNow - step.StartedAtUtc.Value).TotalMilliseconds;
        }
    }

    private static IEnumerable<string> RenderStep(WorkflowStep step, string prefix, bool isLast)
    {
        var connector = isLast ? "└──" : "├──";
        var childPrefix = prefix + (isLast ? "    " : "│   ");
        var duration = step.DurationMs is null ? string.Empty : $" ({step.DurationMs}ms)";
        var message = string.IsNullOrWhiteSpace(step.Message) ? string.Empty : $" - {step.Message}";
        var fields = FormatFields(step.Fields);

        yield return $"{prefix}{connector} {StatusLabel(step.Status)} {step.Name}{duration}{message}{fields}";

        for (var index = 0; index < step.Children.Count; index++)
        {
            foreach (var line in RenderStep(step.Children[index], childPrefix, index == step.Children.Count - 1))
            {
                yield return line;
            }
        }
    }

    private static string StatusEmoji(int statusCode) => statusCode switch
    {
        >= 100 and < 400 => "🟢",
        >= 400 and < 500 => "🟡",
        _ => "🔴",
    };

    private static string StatusLabel(StepStatus status) => status switch
    {
        StepStatus.Success => "[成功]",
        StepStatus.Pending => "[进行中]",
        _ => "[失败]",
    };

    private static string FormatFields(IReadOnlyDictionary<string, string>? fields)
    {
        if (fields is null || fields.Count == 0)
        {
            return string.Empty;
        }

        var builder = new StringBuilder(" - ");
        var first = true;
        foreach (var (key, value) in fields)
        {
            if (!first)
            {
                builder.Append(", ");
            }

            builder.Append(key).Append('=').Append(value);
            first = false;
        }

        return builder.ToString();
    }

    private static WorkflowStep CloneStep(WorkflowStep step)
    {
        return new WorkflowStep
        {
            Name = step.Name,
            Status = step.Status,
            Message = step.Message,
            DurationMs = step.DurationMs,
            Fields = step.Fields is null ? null : new Dictionary<string, string>(step.Fields),
            StartedAtUtc = null,
            Children = step.Children.Select(CloneStep).ToList(),
        };
    }
}
