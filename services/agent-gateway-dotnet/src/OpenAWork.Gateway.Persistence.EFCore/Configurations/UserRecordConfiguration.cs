using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.Persistence.EFCore.Configurations;

public sealed class UserRecordConfiguration : IEntityTypeConfiguration<UserRecord>
{
    public void Configure(EntityTypeBuilder<UserRecord> builder)
    {
        builder.ToTable("users");
        builder.HasKey((user) => user.Id);
        builder.Property((user) => user.Id).HasColumnName("id").IsRequired();
        builder.Property((user) => user.Email).HasColumnName("email").IsRequired();
        builder.Property((user) => user.PasswordHash).HasColumnName("password_hash").IsRequired();
        builder.Property((user) => user.CreatedAtUtc).HasColumnName("created_at").IsRequired();
        builder.HasIndex((user) => user.Email).IsUnique();
    }
}
