namespace OpenAWork.Gateway.Application.Abstractions.Settings;

public interface IWorkflowLlmClient
{
    Task<string> CompleteAsync(string apiBaseUrl, string apiKey, string model, string prompt, double temperature, CancellationToken cancellationToken);
}
