using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.Persistence.EFCore.Configurations;

public sealed class InstalledSkillRecordConfiguration : IEntityTypeConfiguration<InstalledSkillRecord>
{
    public void Configure(EntityTypeBuilder<InstalledSkillRecord> builder)
    {
        builder.ToTable("installed_skills");
        builder.HasKey((skill) => new { skill.SkillId, skill.UserId });
        builder.Property((skill) => skill.SkillId).HasColumnName("skill_id").IsRequired();
        builder.Property((skill) => skill.UserId).HasColumnName("user_id").IsRequired();
        builder.Property((skill) => skill.SourceId).HasColumnName("source_id").IsRequired();
        builder.Property((skill) => skill.ManifestJson).HasColumnName("manifest_json").IsRequired();
        builder.Property((skill) => skill.GrantedPermissionsJson)
            .HasColumnName("granted_permissions_json")
            .HasDefaultValue("[]")
            .IsRequired();
        builder.Property((skill) => skill.Enabled).HasColumnName("enabled").HasDefaultValue(true).IsRequired();
        builder.Property((skill) => skill.InstalledAt).HasColumnName("installed_at").IsRequired();
        builder.Property((skill) => skill.UpdatedAt).HasColumnName("updated_at").IsRequired();
        builder.HasOne((skill) => skill.User)
            .WithMany()
            .HasForeignKey((skill) => skill.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
