import { Component, OnDestroy } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { UntilDestroy, untilDestroyed } from '@ngneat/until-destroy';
import { TranslateService } from '@ngx-translate/core';
import { filter } from 'rxjs/operators';
import { DatasetQuotaType } from 'app/enums/dataset.enum';
import helptext from 'app/helptext/storage/volumes/datasets/dataset-quotas';
import { DatasetQuota, SetDatasetQuota } from 'app/interfaces/dataset-quota.interface';
import { QueryFilter, QueryParams } from 'app/interfaces/query-api.interface';
import { EntityTableComponent } from 'app/modules/entity/entity-table/entity-table.component';
import { EntityTableAction, EntityTableConfig } from 'app/modules/entity/entity-table/entity-table.interface';
import { DatasetQuotaFormComponent } from 'app/pages/storage/volumes/datasets/dataset-quotas/dataset-quota-form/dataset-quota-form.component';
import { DatasetQuotaRow } from 'app/pages/storage/volumes/datasets/dataset-quotas/dataset-quotas-grouplist/dataset-quota-row.interface';
import {
  GroupQuotaFormComponent,
} from 'app/pages/storage/volumes/datasets/dataset-quotas/dataset-quotas-grouplist/group-quota-form/group-quota-form.component';
import {
  AppLoaderService, DialogService, StorageService, WebSocketService,
} from 'app/services';
import { EntityTableService } from 'app/services/entity-table.service';
import { IxSlideInService } from 'app/services/ix-slide-in.service';

@UntilDestroy()
@Component({
  selector: 'app-dataset-quotas-grouplist',
  template: '<entity-table [title]="title" [conf]="this"></entity-table>',
})
export class DatasetQuotasGrouplistComponent implements EntityTableConfig, OnDestroy {
  pk: string;
  title = helptext.groups.table_title;
  protected entityList: EntityTableComponent;
  quotaValue: number;
  protected fullFilter: QueryParams<DatasetQuota> = [['OR', [['quota', '>', 0], ['obj_quota', '>', 0]]]];
  protected emptyFilter: QueryParams<DatasetQuota> = [];
  protected useFullFilter = true;

  columns = [
    {
      name: this.translate.instant('Name'), prop: 'name', always_display: true, minWidth: 150,
    },
    { name: this.translate.instant('ID'), prop: 'id', hidden: true },
    { name: this.translate.instant('Data Quota'), prop: 'quota', hidden: false },
    { name: this.translate.instant('DQ Bytes Used'), prop: 'used_bytes', hidden: false },
    { name: this.translate.instant('DQ % Used'), prop: 'used_percent', hidden: false },
    { name: this.translate.instant('Object Quota'), prop: 'obj_quota', hidden: false },
    { name: this.translate.instant('OQ Objs Used'), prop: 'obj_used', hidden: false },
    { name: this.translate.instant('OQ % Used'), prop: 'obj_used_percent', hidden: false },
  ];
  rowIdentifier = 'name';
  config = {
    paging: true,
    sorting: { columns: this.columns },
    deleteMsg: {
      title: this.translate.instant('Group'),
      key_props: ['name'],
    },
  };

  readonly addActions = [{
    label: this.translate.instant('Toggle Display'),
    onClick: () => {
      this.toggleDisplay();
    },
  }];

  constructor(
    protected ws: WebSocketService,
    protected storageService: StorageService,
    protected dialogService: DialogService,
    protected loader: AppLoaderService,
    protected aroute: ActivatedRoute,
    private translate: TranslateService,
    private tableService: EntityTableService,
    private slideInService: IxSlideInService,
  ) { }

  getRemoveInvalidQuotasAction(invalidQuotas: DatasetQuota[]): EntityTableAction {
    return {
      label: this.translate.instant('Remove quotas for invalid groups'),
      onClick: () => {
        this.dialogService.confirm({
          title: this.translate.instant('Remove invalid quotas'),
          message: this.translate.instant('This action will set all dataset quotas for the removed or invalid groups to 0, \
          virutally removing any dataset quota entires for such groups. \
          Are you sure you want to proceed?'),
          buttonMsg: this.translate.instant('Remove'),
        }).pipe(filter(Boolean), untilDestroyed(this)).subscribe(() => {
          const payload: SetDatasetQuota[] = [];
          for (const quota of invalidQuotas) {
            payload.push({
              id: quota.id.toString(),
              quota_type: DatasetQuotaType.Group,
              quota_value: 0,
            });
            payload.push({
              id: quota.id.toString(),
              quota_type: DatasetQuotaType.GroupObj,
              quota_value: 0,
            });
          }
          this.loader.open();
          this.ws.call('pool.dataset.set_quota', [this.pk, payload]).pipe(untilDestroyed(this)).subscribe(() => {
            this.loader.close();
            this.entityList.getData();
            this.updateAddActions();
          }, (err) => {
            this.loader.close();
            this.dialogService.errorReport('Error', err.reason, err.trace.formatted);
          });
        });
      },
    } as unknown as EntityTableAction;
  }

  getAddActions(): EntityTableAction[] {
    return [...this.addActions] as unknown as EntityTableAction[];
  }

  updateAddActions(): void {
    const params = [['name', '=', null] as QueryFilter<DatasetQuota>] as QueryParams<DatasetQuota>;
    this.ws.call(
      'pool.dataset.get_quota',
      [this.pk, DatasetQuotaType.Group, params],
    ).pipe(untilDestroyed(this)).subscribe((quotas: DatasetQuota[]) => {
      if (quotas && quotas.length) {
        const newActions = [
          ...this.addActions,
          this.getRemoveInvalidQuotasAction(quotas),
        ];
        this.tableService.triggerActionsUpdate(newActions);
      } else {
        this.tableService.triggerActionsUpdate([...this.addActions]);
      }
    });
  }

  getActions(row: DatasetQuotaRow): EntityTableAction[] {
    const actions = [];
    actions.push({
      icon: 'edit',
      label: this.translate.instant('Edit'),
      name: 'edit',
      onClick: () => {
        const form = this.slideInService.open(DatasetQuotaFormComponent);
        form.setupForm(DatasetQuotaType.Group, row.id, this.pk);
      },
    });
    return actions as EntityTableAction[];
  }

  preInit(entityList: EntityTableComponent): void {
    this.entityList = entityList;
    const paramMap = this.aroute.snapshot.params;
    this.pk = paramMap.pk;
    this.useFullFilter = window.localStorage.getItem('useFullFilter') !== 'false';
    this.updateAddActions();

    this.slideInService.onClose$.pipe(untilDestroyed(this)).subscribe(() => {
      entityList.getData();
    });
  }

  callGetFunction(entityList: EntityTableComponent): void {
    const filter = this.useFullFilter ? this.fullFilter : this.emptyFilter;
    this.ws.call('pool.dataset.get_quota', [this.pk, DatasetQuotaType.Group, filter]).pipe(untilDestroyed(this)).subscribe((res) => {
      entityList.handleData(res, true);
    });
  }

  dataHandler(data: EntityTableComponent): void {
    data.rows = data.rows.map((row: DatasetQuota) => {
      return {
        ...row,
        name: row.name
          ? row.name
          : `*ERR* (${this.translate.instant(helptext.shared.nameErr)}), ID: ${row.id}`,
        quota: this.storageService.convertBytesToHumanReadable(row.quota, 0),
        used_percent: `${Math.round((row.used_percent) * 100) / 100}%`,
        obj_used_percent: `${Math.round((row.obj_used_percent) * 100) / 100}%`,
      };
    });
  }

  blurEvent(): void {
    (document.getElementById('data-quota_input') as HTMLInputElement).value = this.storageService.humanReadable;
  }

  toggleDisplay(): void {
    let title; let message; let button;
    if (this.useFullFilter) {
      title = helptext.groups.filter_dialog.title_show;
      message = helptext.groups.filter_dialog.message_show;
      button = helptext.groups.filter_dialog.button_show;
    } else {
      title = helptext.groups.filter_dialog.title_filter;
      message = helptext.groups.filter_dialog.message_filter;
      button = helptext.groups.filter_dialog.button_filter;
    }
    this.dialogService.confirm({
      title,
      message,
      hideCheckBox: true,
      buttonMsg: button,
    }).pipe(filter(Boolean), untilDestroyed(this)).subscribe(() => {
      this.entityList.loader.open();
      this.useFullFilter = !this.useFullFilter;
      window.localStorage.setItem('useFullFilter', this.useFullFilter.toString());
      this.entityList.getData();
      this.loader.close();
    });
  }

  doAdd(): void {
    const slideIn = this.slideInService.open(GroupQuotaFormComponent);
    slideIn.setDatasetId(this.pk);
  }

  ngOnDestroy(): void {
    window.localStorage.setItem('useFullFilter', 'true');
  }
}
