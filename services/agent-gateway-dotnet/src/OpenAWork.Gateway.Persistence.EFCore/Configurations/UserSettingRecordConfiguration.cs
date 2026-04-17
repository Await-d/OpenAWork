using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.Persistence.EFCore.Configurations;

public sealed class UserSettingRecordConfiguration : IEntityTypeConfiguration<UserSettingRecord>
{
    public void Configure(EntityTypeBuilder<UserSettingRecord> builder)
    {
        builder.ToTable("user_settings");
        builder.HasKey((setting) => setting.Id);
        builder.Property((setting) => setting.Id).ValueGeneratedOnAdd().HasColumnName("id");
        builder.Property((setting) => setting.UserId).HasColumnName("user_id").IsRequired();
        builder.Property((setting) => setting.Key).HasColumnName("key").IsRequired();
        builder.Property((setting) => setting.Value).HasColumnName("value").IsRequired();
        builder.Property((setting) => setting.CreatedAtUtc).HasColumnName("created_at").IsRequired();
        builder.Property((setting) => setting.UpdatedAtUtc).HasColumnName("updated_at").IsRequired();
        builder.HasIndex((setting) => new { setting.UserId, setting.Key }).IsUnique();
        builder.HasOne((setting) => setting.User)
            .WithMany()
            .HasForeignKey((setting) => setting.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
