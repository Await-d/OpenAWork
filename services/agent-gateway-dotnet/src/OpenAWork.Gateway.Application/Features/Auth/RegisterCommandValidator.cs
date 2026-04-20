using FluentValidation;

namespace OpenAWork.Gateway.Application.Features.Auth;

public sealed class RegisterCommandValidator : AbstractValidator<RegisterCommand>
{
    public RegisterCommandValidator()
    {
    }
}
