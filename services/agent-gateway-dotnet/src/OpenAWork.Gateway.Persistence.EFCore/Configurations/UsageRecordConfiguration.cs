using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.Persistence.EFCore.Configurations;

public sealed class UsageRecordConfiguration : IEntityTypeConfiguration<UsageRecord>
{
    public void Configure(EntityTypeBuilder<UsageRecord> builder)
    {
        builder.ToTable("usage_records");
        builder.HasKey((record) => record.Id);
        builder.Property((record) => record.Id).ValueGeneratedOnAdd().HasColumnName("id");
        builder.Property((record) => record.UserId).HasColumnName("user_id").IsRequired();
        builder.Property((record) => record.Month).HasColumnName("month").IsRequired();
        builder.Property((record) => record.InputTokens).HasColumnName("input_tokens").IsRequired();
        builder.Property((record) => record.OutputTokens).HasColumnName("output_tokens").IsRequired();
        builder.Property((record) => record.CostUsd).HasColumnName("cost_usd").HasPrecision(18, 6).IsRequired();
        builder.HasIndex((record) => new { record.UserId, record.Month });
        builder.HasOne((record) => record.User)
            .WithMany()
            .HasForeignKey((record) => record.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
