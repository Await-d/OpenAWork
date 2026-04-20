using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.Persistence.EFCore.Configurations;

public sealed class WorkflowTemplateRecordConfiguration : IEntityTypeConfiguration<WorkflowTemplateRecord>
{
    public void Configure(EntityTypeBuilder<WorkflowTemplateRecord> builder)
    {
        builder.ToTable("workflow_templates");
        builder.HasKey((template) => template.Id);
        builder.Property((template) => template.Id).HasColumnName("id").IsRequired();
        builder.Property((template) => template.UserId).HasColumnName("user_id").IsRequired();
        builder.Property((template) => template.Name).HasColumnName("name").IsRequired();
        builder.Property((template) => template.Description).HasColumnName("description");
        builder.Property((template) => template.Category)
            .HasColumnName("category")
            .HasDefaultValue("general")
            .IsRequired();
        builder.Property((template) => template.MetadataJson)
            .HasColumnName("metadata_json")
            .HasDefaultValue("{}")
            .IsRequired();
        builder.Property((template) => template.NodesJson)
            .HasColumnName("nodes_json")
            .HasDefaultValue("[]")
            .IsRequired();
        builder.Property((template) => template.EdgesJson)
            .HasColumnName("edges_json")
            .HasDefaultValue("[]")
            .IsRequired();
        builder.Property((template) => template.CreatedAtUtc)
            .HasColumnName("created_at")
            .HasDefaultValueSql("CURRENT_TIMESTAMP")
            .IsRequired();
        builder.Property((template) => template.UpdatedAtUtc)
            .HasColumnName("updated_at")
            .HasDefaultValueSql("CURRENT_TIMESTAMP")
            .IsRequired();
        builder.HasOne((template) => template.User)
            .WithMany()
            .HasForeignKey((template) => template.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
