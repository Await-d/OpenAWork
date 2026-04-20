using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OpenAWork.Gateway.Persistence.PostgreSql.Migrations
{
    /// <inheritdoc />
    public partial class AddAuthBootstrapDefaults : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "installed_skills",
                columns: table => new
                {
                    skill_id = table.Column<string>(type: "text", nullable: false),
                    user_id = table.Column<string>(type: "text", nullable: false),
                    source_id = table.Column<string>(type: "text", nullable: false),
                    manifest_json = table.Column<string>(type: "text", nullable: false),
                    granted_permissions_json = table.Column<string>(type: "text", nullable: false, defaultValue: "[]"),
                    enabled = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    installed_at = table.Column<long>(type: "bigint", nullable: false),
                    updated_at = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_installed_skills", x => new { x.skill_id, x.user_id });
                    table.ForeignKey(
                        name: "FK_installed_skills_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "workflow_templates",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    user_id = table.Column<string>(type: "text", nullable: false),
                    name = table.Column<string>(type: "text", nullable: false),
                    description = table.Column<string>(type: "text", nullable: true),
                    category = table.Column<string>(type: "text", nullable: false, defaultValue: "general"),
                    metadata_json = table.Column<string>(type: "text", nullable: false, defaultValue: "{}"),
                    nodes_json = table.Column<string>(type: "text", nullable: false, defaultValue: "[]"),
                    edges_json = table.Column<string>(type: "text", nullable: false, defaultValue: "[]"),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_workflow_templates", x => x.id);
                    table.ForeignKey(
                        name: "FK_workflow_templates_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_installed_skills_user_id",
                table: "installed_skills",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "IX_workflow_templates_user_id",
                table: "workflow_templates",
                column: "user_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "installed_skills");

            migrationBuilder.DropTable(
                name: "workflow_templates");
        }
    }
}
