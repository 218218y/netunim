"""Explicit production owners inspected by the existing static contracts."""


def owner_sources(app_root, folder, names):
    return '\n'.join((app_root / f'site/assets/js/{folder}/{name}.js').read_text(encoding='utf-8') for name in names)


def cloud_ui_source(app_root):
    return owner_sources(app_root, 'ui', ('cloud', 'cloud-authentication', 'cloud-opening',
        'cloud-transfer', 'cloud-reset', 'cloud-review', 'cloud-session'))


def sync_document_source(app_root):
    source = owner_sources(app_root, 'sync', ('document', 'save-operation', 'remote-adoption', 'write-flight', 'ack-publication',
        'confirmation', 'polling'))
    if app_root.name == 'netunim-kupa':
        source += owner_sources(app_root, 'cloud', ('main-document-write',))
    return source


def backup_ui_source(app_root):
    return owner_sources(app_root, 'ui', ('backup', 'backup-restore', 'backup-local',
        'backup-catalog', 'backup-presentation', 'backup-download'))


def finance_controller_source(app_root):
    return owner_sources(app_root, 'domains/finance', ('controller', 'cashflow-commands',
        'bank-archive-commands', 'credit-settings-commands', 'connection-commands'))
