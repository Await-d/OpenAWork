using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.Persistence.EFCore.Configurations;

public sealed class RefreshTokenRecordConfiguration : IEntityTypeConfiguration<RefreshTokenRecord>
{
    public void Configure(EntityTypeBuilder<RefreshTokenRecord> builder)
    {
        builder.ToTable("refresh_tokens");
        builder.HasKey((token) => token.Id);
        builder.Property((token) => token.Id).HasColumnName("id").IsRequired();
        builder.Property((token) => token.UserId).HasColumnName("user_id").IsRequired();
        builder.Property((token) => token.TokenHash).HasColumnName("token_hash").IsRequired();
        builder.Property((token) => token.ExpiresAtUtc).HasColumnName("expires_at").IsRequired();
        builder.Property((token) => token.CreatedAtUtc)
            .HasColumnName("created_at")
            .HasDefaultValueSql("CURRENT_TIMESTAMP")
            .IsRequired();
        builder.HasIndex((token) => token.TokenHash).IsUnique();
        builder.HasOne((token) => token.User)
            .WithMany()
            .HasForeignKey((token) => token.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
