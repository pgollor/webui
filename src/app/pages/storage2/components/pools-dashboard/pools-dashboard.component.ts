import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnInit,
  TemplateRef,
  ViewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { UntilDestroy, untilDestroyed } from '@ngneat/until-destroy';
import { TranslateService } from '@ngx-translate/core';
import { TreeNode } from 'primeng/api';
import { DiskType } from 'app/enums/disk-type.enum';
import { PoolStatus } from 'app/enums/pool-status.enum';
import { VDevType } from 'app/enums/v-dev-type.enum';
import { VDevStatus } from 'app/enums/vdev-status.enum';
import { Pool, PoolTopologyCategory } from 'app/interfaces/pool.interface';
import { VDev } from 'app/interfaces/storage.interface';
import { EntityTreeTable } from 'app/modules/entity/entity-tree-table/entity-tree-table.model';
import { WidgetUtils } from 'app/pages/dashboard/utils/widget-utils';
import { ImportPoolComponent } from 'app/pages/storage2/components/import-pool/import-pool.component';
import { WebSocketService } from 'app/services';
import { IxSlideInService } from 'app/services/ix-slide-in.service';
import { LayoutService } from 'app/services/layout.service';

interface DiskInfo {
  name: string;
  status: PoolStatus | VDevStatus;
  capacity: string;
  errors: string;
}

@UntilDestroy()
@Component({
  templateUrl: './pools-dashboard.component.html',
  styleUrls: ['./pools-dashboard.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PoolsDashboardComponent implements OnInit, AfterViewInit {
  @ViewChild('pageHeader') pageHeader: TemplateRef<unknown>;
  private utils: WidgetUtils;

  pools: Pool[];
  isPoolsLoading = false;
  typesDisks: { [diskName: string]: DiskType } = {};

  treeTableConfig: EntityTreeTable = {
    tableData: [],
    columns: [
      { name: this.translate.instant('Device Name'), prop: 'name' },
      { name: this.translate.instant('Status'), prop: 'status' },
      { name: this.translate.instant('Capacity'), prop: 'capacity' },
      { name: this.translate.instant('Errors'), prop: 'errors' },
    ],
  };

  constructor(
    private ws: WebSocketService,
    private router: Router,
    private layoutService: LayoutService,
    private slideIn: IxSlideInService,
    private cdr: ChangeDetectorRef,
    protected translate: TranslateService,
  ) {
    this.utils = new WidgetUtils();
  }

  ngOnInit(): void {
    this.loadPools();

    this.slideIn.onClose$
      .pipe(untilDestroyed(this))
      .subscribe(() => this.loadPools());
  }

  ngAfterViewInit(): void {
    this.layoutService.pageHeaderUpdater$.next(this.pageHeader);
  }

  onImportPool(): void {
    this.slideIn.open(ImportPoolComponent);
  }

  loadPools(): void {
    // TODO: Add loading indicator
    // TODO: Handle error
    this.isPoolsLoading = true;
    this.ws.call('pool.query', [[], { extra: { is_upgraded: true } }]).pipe(untilDestroyed(this)).subscribe(
      (pools: Pool[]) => {
        this.pools = pools;
        this.isPoolsLoading = false;
        this.cdr.markForCheck();
        this.ws.call('disk.query', [[['type', '=', DiskType.Hdd]]]).pipe(untilDestroyed(this)).subscribe((disks) => {
          for (const disk of disks) {
            this.typesDisks[disk.name] = disk.type;
          }
          this.ws.call('disk.query', [[['type', '=', DiskType.Ssd]]]).pipe(untilDestroyed(this)).subscribe((disks) => {
            for (const disk of disks) {
              this.typesDisks[disk.name] = disk.type;
            }
            this.updateTable(this.pools);
            this.cdr.markForCheck();
          });
        });
      },
    );
  }

  updateTable(pools: Pool[]): void {
    const rootNode: TreeNode = {};
    rootNode.data = {
      name: this.translate.instant('All Pools'),
    };
    rootNode.expanded = true;
    rootNode.children = [];

    for (const pool of pools) {
      rootNode.children.push(this.dataHandler(pool));
    }

    this.treeTableConfig = {
      tableData: [rootNode],
      columns: [...this.treeTableConfig.columns],
    };
  }

  dataHandler(pool: Pool): TreeNode {
    const node: TreeNode = {};
    node.data = this.parseData(pool);
    node.expanded = true;
    node.children = [];

    let category: PoolTopologyCategory;
    for (category in pool.topology) {
      const topoNode: TreeNode = {};
      topoNode.data = {
        name: category,
      };
      topoNode.expanded = true;
      topoNode.children = [];

      pool.topology[category].forEach((vdev) => {
        if (category !== 'data') {
          topoNode.children.push(this.parseTopolgy(vdev, category));
        } else {
          node.children.push(this.parseTopolgy(vdev, category));
        }
      });
      if (category !== 'data' && pool.topology[category].length > 0) {
        node.children.push(topoNode);
      }
    }
    delete node.data.children;
    return node;
  }

  parseData(data: Pool | VDev): DiskInfo {
    if ('type' in data && data.type !== VDevType.Disk) {
      (data as any).name = data.type;
    }

    let errors = '';
    if ('stats' in data) {
      if (data.stats.read_errors + data.stats.write_errors + data.stats.checksum_errors > 0) {
        errors = data.stats.read_errors + data.stats.write_errors + data.stats.checksum_errors + ' Errors';
      } else {
        errors = this.translate.instant('No Errors');
      }
    }

    const item: DiskInfo = {
      name: 'name' in data ? data.name : data.disk,
      status: data.status,
      capacity: 'stats' in data
        ? this.utils.convert(data.stats.bytes[2]).value
        + this.utils.convert(data.stats.bytes[2]).units
        : '',
      errors: 'stats' in data ? errors : '',
    };
    return item;
  }

  parseTopolgy(data: VDev, category: PoolTopologyCategory, vdevType?: VDevType): TreeNode {
    const node: TreeNode = {};
    node.data = this.parseData(data);
    node.expanded = true;
    node.children = [];

    if (data.children) {
      vdevType = (data as any).name;
      data.children.forEach((child) => {
        node.children.push(this.parseTopolgy(child, category, vdevType));
      });
    }

    if ('name' in data && node.children.length) {
      if (this.typesDisks[node.children[0].data.name] === DiskType.Hdd) {
        node.icon = 'ix-hdd-mirror';
      }
      if (this.typesDisks[node.children[0].data.name] === DiskType.Ssd) {
        node.icon = 'ix-ssd-mirror';
      }
    } else {
      if (this.typesDisks[node.data.name] === DiskType.Hdd) {
        node.icon = 'ix-hdd';
      }
      if (this.typesDisks[node.data.name] === DiskType.Ssd) {
        node.icon = 'ix-ssd';
      }
    }

    delete node.data.children;
    return node;
  }
}
