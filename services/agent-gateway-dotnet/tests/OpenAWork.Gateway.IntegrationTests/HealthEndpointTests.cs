using System.Net.Http.Json;
using OpenAWork.Gateway.Contracts.Health;

namespace OpenAWork.Gateway.IntegrationTests;

public sealed class HealthEndpointTests : IClassFixture<GatewayWebApplicationFactory>
{
    private readonly GatewayWebApplicationFactory _factory;

    public HealthEndpointTests(GatewayWebApplicationFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task Health_ShouldReturnHealthyPayload()
    {
        using var client = _factory.CreateClient();

        var response = await client.GetAsync("/health");
        var payload = await response.Content.ReadFromJsonAsync<HealthResponse>();

        response.EnsureSuccessStatusCode();
        Assert.NotNull(payload);
        Assert.Equal("healthy", payload.Status);
        Assert.Equal("OpenAWork.Gateway.DotNet", payload.Service);
    }
}
