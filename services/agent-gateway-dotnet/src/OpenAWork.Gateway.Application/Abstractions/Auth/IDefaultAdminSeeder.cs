namespace OpenAWork.Gateway.Application.Abstractions.Auth;

public interface IDefaultAdminSeeder
{
    Task SeedAsync(CancellationToken cancellationToken);
}
