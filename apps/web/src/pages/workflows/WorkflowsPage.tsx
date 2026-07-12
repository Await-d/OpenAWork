import { WorkflowCanvas, WorkflowTemplateLibrary } from '@openAwork/shared-ui';
import { Link } from 'react-router';
import { useWorkflowStudio } from './use-workflow-studio.js';

export default function WorkflowsPage() {
  const {
    addNode,
    busy,
    draftEdges,
    draftNodes,
    error,
    feedback,
    loading,
    removeSelectedTemplate,
    saveTemplate,
    selectedNode,
    selectedNodeId,
    selectedTemplate,
    setSelectedNodeId,
    setSelectedTemplateId,
    templates,
    updateSelectedNode,
  } = useWorkflowStudio();

  return (
    <div className="page-root">
      <div className="page-header">
        <span className="page-title">工作流工作台</span>
        <span className="page-subtitle">把流程模板、节点编排和协作剧本真正接成可见入口</span>
      </div>
      <div className="page-content">
        <div
          style={{
            maxWidth: 'min(1480px, 100%)',
            margin: '0 auto',
            padding: '24px',
            display: 'grid',
            gap: 18,
          }}
        >
          <section
            className="content-card"
            style={{
              display: 'grid',
              gap: 14,
              padding: 22,
              borderRadius: 24,
              background:
                'radial-gradient(circle at top left, var(--accent-border), transparent 36%), linear-gradient(135deg, var(--bg-overlay) 0%, var(--bg-overlay) 100%)',
            }}
          >
            <div style={{ display: 'grid', gap: 8 }}>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  color: 'var(--accent)',
                }}
              >
                Workflow studio
              </span>
              <span
                style={{
                  fontSize: 'clamp(28px, 4vw, 44px)',
                  fontWeight: 800,
                  lineHeight: 1.02,
                  letterSpacing: '-0.04em',
                }}
              >
                把模板库、画布和流程沉淀拉回主界面。
              </span>
              <span
                style={{ maxWidth: 860, fontSize: 14, lineHeight: 1.8, color: 'var(--fg-default)' }}
              >
                现在你可以直接在产品内查看已有流程模板、可视化预览节点关系、补新的步骤并另存为团队可复用剧本，不再需要把
                workflow 能力藏在后端接口和共享组件里。
              </span>
            </div>
            {feedback ? (
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: 10,
                  border: `1px solid ${feedback.tone === 'success' ? 'var(--success-border)' : 'var(--complement-border)'}`,
                  background:
                    feedback.tone === 'success'
                      ? 'var(--success-muted)'
                      : 'var(--complement-muted)',
                  color: feedback.tone === 'success' ? 'var(--success)' : 'var(--complement)',
                  fontSize: 12,
                  fontWeight: 500,
                }}
              >
                {feedback.message}
              </div>
            ) : null}
            {error ? (
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: 10,
                  border: '1px solid var(--complement-border)',
                  background: 'var(--complement-muted)',
                  color: 'var(--complement)',
                  fontSize: 12,
                  fontWeight: 500,
                }}
              >
                {error}
              </div>
            ) : null}
          </section>

          <section
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(320px, 380px) minmax(0, 1fr)',
              gap: 16,
            }}
          >
            <div
              className="content-card"
              style={{ display: 'grid', gap: 14, padding: 18, alignContent: 'start' }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  alignItems: 'center',
                }}
              >
                <div style={{ display: 'grid', gap: 4 }}>
                  <span style={{ fontSize: 18, fontWeight: 700 }}>模板库</span>
                  <span style={{ fontSize: 13, color: 'var(--fg-muted)' }}>
                    {loading ? '正在同步模板…' : `已加载 ${templates.length} 个工作流模板`}
                  </span>
                </div>
                {selectedTemplate ? (
                  <button
                    type="button"
                    className="btn-danger-sm"
                    onClick={() => void removeSelectedTemplate()}
                    disabled={busy}
                  >
                    删除模板
                  </button>
                ) : null}
              </div>
              <WorkflowTemplateLibrary
                templates={templates.map((template) => ({
                  id: template.id,
                  name: template.name,
                  description: template.description ?? '暂无描述',
                  isPublic: false,
                  nodeCount: template.nodes.length,
                }))}
                onSave={(name, desc) => void saveTemplate(name, desc)}
                onSelect={setSelectedTemplateId}
              />
            </div>

            <div style={{ display: 'grid', gap: 16 }}>
              <div className="content-card" style={{ display: 'grid', gap: 14, padding: 18 }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                    alignItems: 'center',
                  }}
                >
                  <div style={{ display: 'grid', gap: 4 }}>
                    <span style={{ fontSize: 18, fontWeight: 700 }}>
                      {selectedTemplate ? selectedTemplate.name : '未命名工作流草稿'}
                    </span>
                    <span style={{ fontSize: 13, color: 'var(--fg-muted)' }}>
                      {selectedTemplate?.description ??
                        '当前是可编辑草稿，你可以继续加节点并另存成模板。'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    {selectedTemplate ? (
                      <Link
                        to={`/team?workflowTemplateId=${encodeURIComponent(selectedTemplate.id)}&workflowTemplateName=${encodeURIComponent(selectedTemplate.name)}&workflowTemplateDescription=${encodeURIComponent(selectedTemplate.description ?? '')}&workflowTemplateNodeCount=${selectedTemplate.nodes.length}`}
                        className="btn-accent"
                        style={{
                          textDecoration: 'none',
                          height: 32,
                          padding: '0 14px',
                          fontSize: 12,
                        }}
                      >
                        在 Team 中发起
                      </Link>
                    ) : null}
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={addNode}
                      disabled={busy}
                    >
                      添加节点
                    </button>
                  </div>
                </div>
                <WorkflowCanvas
                  edges={draftEdges}
                  nodes={draftNodes}
                  onAddNode={addNode}
                  onSelectNode={setSelectedNodeId}
                  selectedNodeId={selectedNodeId}
                  style={{ minHeight: 420 }}
                />
              </div>

              <div className="content-card" style={{ display: 'grid', gap: 14, padding: 18 }}>
                <div style={{ display: 'grid', gap: 4 }}>
                  <span style={{ fontSize: 18, fontWeight: 700 }}>节点检查器</span>
                  <span style={{ fontSize: 13, color: 'var(--fg-muted)' }}>
                    选中画布上的节点后，可以直接修改标题和类型，快速把草稿推向可复用模板。
                  </span>
                </div>
                {selectedNode ? (
                  <div style={{ display: 'grid', gap: 10 }}>
                    <input
                      name="workflow-node-label"
                      value={selectedNode.label}
                      onChange={(event) => updateSelectedNode({ label: event.target.value })}
                      placeholder="节点标题"
                      className="form-input"
                    />
                    <select
                      value={selectedNode.type}
                      onChange={(event) =>
                        updateSelectedNode({
                          type: event.target.value as typeof selectedNode.type,
                        })
                      }
                      className="form-input"
                    >
                      <option value="start">start</option>
                      <option value="prompt">prompt</option>
                      <option value="tool">tool</option>
                      <option value="condition">condition</option>
                      <option value="subagent">subagent</option>
                      <option value="end">end</option>
                    </select>
                  </div>
                ) : (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 10,
                      padding: '24px 16px',
                      color: 'var(--fg-muted)',
                      textAlign: 'center',
                    }}
                  >
                    <svg
                      width="28"
                      height="28"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                      style={{ opacity: 0.5 }}
                    >
                      <circle cx="12" cy="12" r="10" />
                      <path d="M8 12h8M12 8v8" />
                    </svg>
                    <span style={{ fontSize: 12 }}>先在画布里选择一个节点，即可在此编辑属性。</span>
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
