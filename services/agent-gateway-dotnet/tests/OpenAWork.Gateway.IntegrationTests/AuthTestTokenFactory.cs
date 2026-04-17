using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.IdentityModel.Tokens;

namespace OpenAWork.Gateway.IntegrationTests;

internal static class AuthTestTokenFactory
{
    private const string DefaultJwtSecret = "change-me-in-production-min-32-chars";

    public static string Create(string userId, string email = "test@openawork.local")
    {
        var credentials = new SigningCredentials(
            new SymmetricSecurityKey(Encoding.UTF8.GetBytes(DefaultJwtSecret)),
            SecurityAlgorithms.HmacSha256);

        var token = new JwtSecurityToken(
            claims:
            [
                new Claim("sub", userId),
                new Claim("email", email),
            ],
            expires: DateTime.UtcNow.AddMinutes(30),
            signingCredentials: credentials);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
