using FluentValidation;

namespace OpenAWork.Gateway.Application.Features.Auth;

public sealed class LoginCommandValidator : AbstractValidator<LoginCommand>
{
    public LoginCommandValidator()
    {
    }
}
